// SherLock - Background Service Worker
// Uses the WebExtensions native messaging API in Firefox and Chromium.

const browser = globalThis.browser ?? globalThis.chrome;

let nativePort = null;
// Map from request_id → { resolve, reject, timeoutId }
const pendingRequests = new Map();
let nextRequestId = 1;
const REQUEST_TIMEOUT_MS = 10_000;
let browserAuthPromise = null;

function connectToNative() {
  if (nativePort) return;
  try {
    nativePort = browser.runtime.connectNative("sherlock");
    console.log("[sherlock] Connected to native messaging host");

    nativePort.onMessage.addListener((response) => {
      const id = response?.request_id;
      if (id !== undefined && pendingRequests.has(id)) {
        const { resolve, reject, timeoutId } = pendingRequests.get(id);
        clearTimeout(timeoutId);
        pendingRequests.delete(id);
        if (response.success) {
          resolve(response);
        } else {
          reject(new Error(response.error || "Unknown native host error"));
        }
      } else {
        console.warn("[sherlock] Response with no/unknown request_id:", {
          success: response?.success,
          error: response?.error,
        });
      }
    });

    nativePort.onDisconnect.addListener(() => {
      const errorMessage =
        nativePort?.error?.message ||
        browser.runtime.lastError?.message ||
        "Native messaging host disconnected";
      console.error("[sherlock] Native port disconnected:", errorMessage);
      nativePort = null;
      for (const [_id, { reject, timeoutId }] of pendingRequests) {
        clearTimeout(timeoutId);
        reject(new Error(errorMessage));
      }
      pendingRequests.clear();
    });
  } catch (error) {
    console.error("[sherlock] Error connecting to native host:", error);
    nativePort = null;
  }
}

async function sendNativeMessage(action, payload = {}) {
  if (!nativePort) {
    connectToNative();
  }
  if (!nativePort) {
    return Promise.reject(new Error("Native messaging port is not available"));
  }

  const id = nextRequestId++;
  const message = {
    action,
    request_id: id,
    // extension_id is omitted intentionally: the host no longer uses it
    // (the browser manifest is the identity gate).
    ...payload,
  };

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        // Disconnect so next call gets a fresh port
        if (nativePort) {
          try {
            nativePort.disconnect();
          } catch (_) {}
          nativePort = null;
        }
        reject(new Error(`Native host timeout for action "${action}"`));
      }
    }, REQUEST_TIMEOUT_MS);

    pendingRequests.set(id, { resolve, reject, timeoutId });
    try {
      nativePort.postMessage(message);
    } catch (error) {
      clearTimeout(timeoutId);
      pendingRequests.delete(id);
      nativePort = null;
      reject(error);
    }
  });
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function hexToBytes(hex) {
  if (
    typeof hex !== "string" ||
    hex.length % 2 !== 0 ||
    !/^[0-9a-f]+$/i.test(hex)
  ) {
    throw new Error("La clau o el repte del navegador no és vàlid");
  }
  return Uint8Array.from(hex.match(/.{2}/g), (byte) => parseInt(byte, 16));
}

async function pairBrowser(code) {
  const normalizedCode = String(code || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new Error(
      "Introdueix el codi de sis xifres que mostra l'app SherLock",
    );
  }

  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicKey = bytesToHex(
    await crypto.subtle.exportKey("raw", keyPair.publicKey),
  );
  const privateKey = bytesToHex(
    await crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
  );

  let browserName = "Browser";
  if (browser.runtime.getBrowserInfo) {
    try {
      browserName =
        (await browser.runtime.getBrowserInfo()).name || browserName;
    } catch (_) {}
  } else if (globalThis.navigator?.userAgent?.includes("Chrome")) {
    browserName = "Chrome";
  }

  const result = await sendNativeMessage("pairBrowser", {
    code: normalizedCode,
    public_key: publicKey,
    browser: browserName,
    label: `SherLock — ${browserName}`,
  });

  await browser.storage.local.set({
    sherlock_browser_client_id: result.client_id,
    sherlock_browser_private_key: privateKey,
  });
  return { success: true, browser: browserName };
}

async function authenticatePairedBrowser() {
  if (browserAuthPromise) return browserAuthPromise;
  browserAuthPromise = (async () => {
    const {
      sherlock_browser_client_id: clientId,
      sherlock_browser_private_key: privateKeyHex,
    } = await browser.storage.local.get([
      "sherlock_browser_client_id",
      "sherlock_browser_private_key",
    ]);

    if (!clientId || !privateKeyHex) {
      throw new Error(
        "Aquest navegador no està vinculat. Vincula'l des dels Ajustos.",
      );
    }

    const challenge = await sendNativeMessage("getBrowserChallenge", {
      client_id: clientId,
    });
    if (!challenge.nonce)
      throw new Error("No s'ha rebut el repte de vinculació");

    const signingKey = await crypto.subtle.importKey(
      "pkcs8",
      hexToBytes(privateKeyHex),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      signingKey,
      hexToBytes(challenge.nonce),
    );

    await sendNativeMessage("authenticatePairedBrowser", {
      client_id: clientId,
      nonce: challenge.nonce,
      signature: bytesToHex(signature),
    });
  })();

  try {
    await browserAuthPromise;
  } catch (error) {
    if (/unknown or unapproved client|client not found/i.test(error.message)) {
      await browser.storage.local.remove([
        "sherlock_browser_client_id",
        "sherlock_browser_private_key",
      ]);
    }
    throw error;
  } finally {
    browserAuthPromise = null;
  }
}

async function sendToNative(action, payload = {}) {
  if (
    [
      "listCredentials",
      "fetchCredentials",
      "saveCredentials",
      "lockVault",
    ].includes(action)
  ) {
    await authenticatePairedBrowser();
  }
  return sendNativeMessage(action, payload);
}

async function getVaultInfo() {
  const {
    sherlock_browser_client_id: clientId,
    sherlock_browser_private_key: privateKey,
  } = await browser.storage.local.get([
    "sherlock_browser_client_id",
    "sherlock_browser_private_key",
  ]);

  if (clientId && privateKey) {
    await authenticatePairedBrowser();
  }

  return sendToNative("getVaultInfo");
}

async function lockVault() {
  return sendToNative("lockVault");
}

async function fetchCredentials(domain = "") {
  return sendToNative("fetchCredentials", { site: domain || "" });
}

async function listCredentials() {
  return sendToNative("listCredentials");
}

async function saveCredential(data) {
  return sendToNative("saveCredentials", { data });
}

async function generatePassword(options = {}) {
  return sendToNative("generatePassword", { options });
}

function senderInfo(sender = {}) {
  let url = null;
  try {
    url = new URL(sender.url);
  } catch {
    url = null;
  }
  const host = url?.hostname.toLowerCase().replace(/^www\./, "") || "";
  const extensionBase = browser.runtime.getURL("");
  const isExtensionPage =
    sender.id === browser.runtime.id &&
    typeof sender.url === "string" &&
    sender.url.startsWith(extensionBase);
  const isTopFrameContentScript =
    sender.id === browser.runtime.id &&
    sender.frameId === 0 &&
    Boolean(url) &&
    ["http:", "https:"].includes(url.protocol) &&
    Boolean(host);
  return { url, host, isExtensionPage, isTopFrameContentScript };
}

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (
    request.action === "sherlockGetCredentialChoices" ||
    request.action === "sherlockSelectCredential"
  ) {
    // Only top-frame content scripts may request credentials, and the requested
    // hostname must match the browser-verified sender URL.
    const senderUrl = (() => {
      try {
        return new URL(sender.url);
      } catch {
        return null;
      }
    })();
    const requestedHost = String(request.domain || "")
      .toLowerCase()
      .replace(/^www\./, "");
    const senderHost = senderUrl?.hostname.toLowerCase().replace(/^www\./, "");
    if (
      sender.id !== browser.runtime.id ||
      sender.frameId !== 0 ||
      !senderUrl ||
      !["http:", "https:"].includes(senderUrl.protocol) ||
      !senderHost ||
      requestedHost !== senderHost
    ) {
      sendResponse({ success: false, error: "Untrusted sender" });
      return false;
    }

    (async () => {
      try {
        const response = await fetchCredentials(senderHost);
        if (!response?.success) throw new Error("Credential lookup failed");
        const credentials = (response?.credentials || []).filter(
          (credential) => {
            let site = String(
              credential.site || credential.url || credential.domain || "",
            ).toLowerCase();
            try {
              site = new URL(
                site.includes("://") ? site : `https://${site}`,
              ).hostname.toLowerCase();
            } catch {
              return false;
            }
            site = site.replace(/^www\./, "");
            return senderHost === site || senderHost.endsWith(`.${site}`);
          },
        );
        if (request.action === "sherlockGetCredentialChoices") {
          sendResponse({
            success: true,
            choices: credentials.map((credential) => ({
              id: String(credential.id || ""),
              username: String(credential.username || credential.email || ""),
              domain: senderHost,
            })),
          });
          return;
        }
        const selected = credentials.find((credential) =>
          request.credentialId
            ? String(credential.id || "") === String(request.credentialId)
            : String(credential.username || credential.email || "") ===
              String(request.username || ""),
        );
        if (!selected) {
          sendResponse({
            success: false,
            error: "Credential not found for this site",
          });
          return;
        }
        // The password crosses into the content script only after the user
        // selected a visible choice (or clicked the icon for a single match).
        sendResponse({
          success: true,
          credential: {
            username: String(selected.username || selected.email || ""),
            password: String(selected.password || ""),
          },
        });
      } catch {
        sendResponse({
          success: false,
          locked: true,
          error: "SherLock is unavailable or locked",
        });
      }
    })();
    return true;
  }

  if (request.action === "pairBrowser") {
    pairBrowser(request.code)
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "getVaultInfo") {
    getVaultInfo()
      .then(sendResponse)
      .catch((error) => {
        console.error("[sherlock] getVaultInfo error:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === "lockVault") {
    lockVault()
      .then(sendResponse)
      .catch((error) => {
        console.error("[sherlock] lockVault error:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === "fetchCredentials") {
    const info = senderInfo(sender);
    const domain = String(request.site || request.domain || "")
      .toLowerCase()
      .replace(/^www\./, "");
    if (
      !info.isExtensionPage &&
      !(info.isTopFrameContentScript && domain && domain === info.host)
    ) {
      sendResponse({ success: false, error: "Untrusted sender" });
      return false;
    }
    fetchCredentials(domain)
      .then(sendResponse)
      .catch((error) => {
        console.error("[sherlock] fetchCredentials error:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === "listCredentials") {
    const info = senderInfo(sender);
    if (!info.isExtensionPage && !info.isTopFrameContentScript) {
      sendResponse({ success: false, error: "Untrusted sender" });
      return false;
    }
    listCredentials()
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "saveCredentials") {
    // A content script may only save for its own host. The extension popup is
    // trusted to save the site the user typed into the form.
    const info = senderInfo(sender);
    const requestedHost = String(request.data?.site || "")
      .toLowerCase()
      .replace(/^www\./, "");
    if (
      !info.isExtensionPage &&
      !(
        info.isTopFrameContentScript &&
        requestedHost &&
        requestedHost === info.host
      )
    ) {
      sendResponse({ success: false, error: "Emisor no de confiança" });
      return false;
    }

    saveCredential(request.data || request)
      .then(sendResponse)
      .catch((error) => {
        console.error("[sherlock] saveCredentials error:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === "generatePassword") {
    generatePassword(request.options || {})
      .then(sendResponse)
      .catch((error) => {
        console.error("[sherlock] generatePassword error:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  // Use async/await + Promise form so this works in both Firefox and Chrome.
  if (request.action === "getActiveTab") {
    browser.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => {
        if (tabs && tabs[0]) {
          try {
            const urlObj = new URL(tabs[0].url);
            sendResponse({
              id: tabs[0].id,
              url: tabs[0].url,
              hostname: urlObj.hostname.replace(/^www\./, ""),
              title: tabs[0].title,
            });
          } catch (_) {
            // URL parsing failed (about:, chrome://, etc.)
            sendResponse({
              id: tabs[0].id,
              url: tabs[0].url,
              hostname: "",
              title: tabs[0].title,
            });
          }
        } else {
          sendResponse(null);
        }
      })
      .catch((error) => {
        console.error("[sherlock] getActiveTab error:", error);
        sendResponse(null);
      });
    return true;
  }

  return false;
});

browser.runtime.onInstalled.addListener(() => {
  try {
    browser.contextMenus.create({
      id: "sherlock_autofill",
      title: "SherLock: Omplir dades d'accés",
      contexts: ["editable"],
    });
    browser.contextMenus.create({
      id: "sherlock_generate",
      title: "SherLock: Generar contrasenya segura",
      contexts: ["editable"],
    });
  } catch (e) {
    console.error("[sherlock] Error creating context menus:", e);
  }
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;
  if (info.menuItemId === "sherlock_autofill") {
    try {
      const urlObj = new URL(tab.url);
      const creds = await fetchCredentials(urlObj.hostname);
      if (creds.success && creds.credentials && creds.credentials.length > 0) {
        browser.tabs.sendMessage(
          tab.id,
          {
            action: "autofillLogin",
            credential: creds.credentials[0],
          },
          { frameId: 0 },
        );
      }
    } catch (e) {
      console.error("[sherlock] Error in autofill context menu:", e);
    }
  } else if (info.menuItemId === "sherlock_generate") {
    const gen = await generatePassword({ length: 18 });
    if (gen.success) {
      browser.tabs.sendMessage(
        tab.id,
        {
          action: "fillGeneratedPassword",
          password: gen.password,
        },
        { frameId: 0 },
      );
    }
  }
});

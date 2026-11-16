// Caixa Forta - Background Service Worker
// Uses the WebExtensions native messaging API in Firefox and Chromium.
//
// Phase 1 changes:
//  - Removed computeExtensionHash() / browser.runtime.getManifestUrl() (did not exist).
//  - Each native message now carries a unique request_id; responses are matched by
//    ID instead of FIFO order, so out-of-order replies never corrupt pending requests.
//  - Added per-request timeout (10 s) with automatic port reconnect.
//  - getActiveTab now uses the Promise form (async/await) so it works in both
//    Firefox (Promise-based browser.*) and Chrome (callback-based chrome.*).

const browser = globalThis.browser ?? globalThis.chrome;

// ── Native port management

let nativePort = null;
// Map from request_id → { resolve, reject, timeoutId }
const pendingRequests = new Map();
let nextRequestId = 1;
const REQUEST_TIMEOUT_MS = 10_000;
let browserAuthPromise = null;

function connectToNative() {
  if (nativePort) return;
  try {
    nativePort = browser.runtime.connectNative("caixa_forta");
    console.log("[caixa] Connected to native messaging host");

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
        // Legacy: fall back to FIFO only if no request_id present (old host)
        console.warn("[caixa] Response with no/unknown request_id:", response);
      }
    });

    nativePort.onDisconnect.addListener(() => {
      const errorMessage =
        nativePort?.error?.message ||
        browser.runtime.lastError?.message ||
        "Native messaging host disconnected";
      console.error("[caixa] Native port disconnected:", errorMessage);
      nativePort = null;
      // Reject all pending requests
      for (const [id, { reject, timeoutId }] of pendingRequests) {
        clearTimeout(timeoutId);
        reject(new Error(errorMessage));
      }
      pendingRequests.clear();
    });
  } catch (error) {
    console.error("[caixa] Error connecting to native host:", error);
    nativePort = null;
  }
}

// ── Send a message to the native host

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
      "Introdueix el codi de sis xifres que mostra l'app Caixa Forta",
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
    label: `Caixa Forta — ${browserName}`,
  });

  await browser.storage.local.set({
    caixa_browser_client_id: result.client_id,
    caixa_browser_private_key: privateKey,
  });
  return { success: true, browser: browserName };
}

async function authenticatePairedBrowser() {
  if (browserAuthPromise) return browserAuthPromise;
  browserAuthPromise = (async () => {
    const {
      caixa_browser_client_id: clientId,
      caixa_browser_private_key: privateKeyHex,
    } = await browser.storage.local.get([
      "caixa_browser_client_id",
      "caixa_browser_private_key",
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
        "caixa_browser_client_id",
        "caixa_browser_private_key",
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

// ── Public vault actions ──────────────

async function getVaultInfo() {
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

// ── Message router (popup / content scripts) ───────

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
        console.error("[caixa] getVaultInfo error:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === "lockVault") {
    lockVault()
      .then(sendResponse)
      .catch((error) => {
        console.error("[caixa] lockVault error:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === "fetchCredentials") {
    const domain = request.site || request.domain || "";
    fetchCredentials(domain)
      .then(sendResponse)
      .catch((error) => {
        console.error("[caixa] fetchCredentials error:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === "listCredentials") {
    listCredentials()
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === "saveCredentials") {
    saveCredential(request.data || request)
      .then(sendResponse)
      .catch((error) => {
        console.error("[caixa] saveCredentials error:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === "generatePassword") {
    generatePassword(request.options || {})
      .then(sendResponse)
      .catch((error) => {
        console.error("[caixa] generatePassword error:", error);
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
            sendResponse({ id: tabs[0].id, url: "", hostname: "", title: "" });
          }
        } else {
          sendResponse(null);
        }
      })
      .catch((error) => {
        console.error("[caixa] getActiveTab error:", error);
        sendResponse(null);
      });
    return true;
  }

  return false;
});

// ── Context menus

browser.runtime.onInstalled.addListener(() => {
  try {
    browser.contextMenus.create({
      id: "caixa_autofill",
      title: "Caixa Forta: Omplir dades d'accés",
      contexts: ["editable"],
    });
    browser.contextMenus.create({
      id: "caixa_generate",
      title: "Caixa Forta: Generar contrasenya segura",
      contexts: ["editable"],
    });
  } catch (e) {
    console.error("[caixa] Error creating context menus:", e);
  }
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;
  if (info.menuItemId === "caixa_autofill") {
    try {
      const urlObj = new URL(tab.url);
      const creds = await fetchCredentials(urlObj.hostname);
      if (creds.success && creds.credentials && creds.credentials.length > 0) {
        browser.tabs.sendMessage(tab.id, {
          action: "autofillLogin",
          credential: creds.credentials[0],
        });
      }
    } catch (e) {
      console.error("[caixa] Error in autofill context menu:", e);
    }
  } else if (info.menuItemId === "caixa_generate") {
    const gen = await generatePassword({ length: 18 });
    if (gen.success) {
      browser.tabs.sendMessage(tab.id, {
        action: "fillGeneratedPassword",
        password: gen.password,
      });
    }
  }
});

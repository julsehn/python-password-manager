// Caixa Forta - Background Service Worker
// Uses the WebExtensions native messaging API in Firefox and Chromium.

const browser = globalThis.browser ?? globalThis.chrome;

// Establish connection to native messaging host
let nativePort = null;
const pendingNativeRequests = [];

function connectToNative() {
  if (!nativePort) {
    try {
      nativePort = browser.runtime.connectNative("caixa_forta");
      console.log("Connected to native messaging host");

      nativePort.onMessage.addListener((response) => {
        console.log("Received from native:", response);
        const request = pendingNativeRequests.shift();
        if (request) {
          if (response.success) {
            request.resolve(response);
          } else {
            request.reject(
              new Error(response.error || "Unknown native host error"),
            );
          }
        }
      });

      nativePort.onDisconnect.addListener(() => {
        const errorMessage =
          nativePort?.error?.message ||
          browser.runtime.lastError?.message ||
          "Native messaging host disconnected without an error";
        console.error("Native messaging port disconnected:", errorMessage);
        while (pendingNativeRequests.length) {
          pendingNativeRequests.shift().reject(new Error(errorMessage));
        }
        nativePort = null;
      });
    } catch (error) {
      console.error("Error connecting to native messaging host:", error);
      nativePort = null;
    }
  }
}

// Send message to native host
function sendToNative(action, payload = {}) {
  if (!nativePort) {
    connectToNative();
  }

  if (!nativePort) {
    return Promise.reject(new Error("Native messaging port is not available"));
  }

  const message = { action, ...payload };
  return new Promise((resolve, reject) => {
    pendingNativeRequests.push({ resolve, reject });
    try {
      nativePort.postMessage(message);
    } catch (error) {
      pendingNativeRequests.pop();
      reject(error);
    }
  });
}

// Get Vault Info
async function getVaultInfo() {
  return sendToNative("getVaultInfo");
}

// Unlock Vault
async function unlockVault(masterPassword) {
  return sendToNative("unlockVault", { masterPassword });
}

// Lock Vault
async function lockVault() {
  return sendToNative("lockVault");
}

// Fetch Credentials
async function fetchCredentials(domain = "") {
  return sendToNative("fetchCredentials", { site: domain || "" });
}

// Save Credential
async function saveCredential(data) {
  return sendToNative("saveCredentials", { data });
}

// Generate Password
async function generatePassword(options = {}) {
  return sendToNative("generatePassword", { options });
}

// Message Listener for Popup and Content Scripts
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getVaultInfo") {
    getVaultInfo()
      .then(sendResponse)
      .catch((error) => {
        console.error("Error in getVaultInfo:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === "unlockVault") {
    unlockVault(request.masterPassword)
      .then(sendResponse)
      .catch((error) => {
        console.error("Error in unlockVault:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === "lockVault") {
    lockVault()
      .then(sendResponse)
      .catch((error) => {
        console.error("Error in lockVault:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === "fetchCredentials") {
    const domain = request.site || request.domain || "";
    fetchCredentials(domain)
      .then(sendResponse)
      .catch((error) => {
        console.error("Error in fetchCredentials:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === "saveCredentials") {
    saveCredential(request.data || request)
      .then(sendResponse)
      .catch((error) => {
        console.error("Error in saveCredentials:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === "generatePassword") {
    generatePassword(request.options || {})
      .then(sendResponse)
      .catch((error) => {
        console.error("Error in generatePassword:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === "getActiveTab") {
    browser.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) {
        try {
          const urlObj = new URL(tabs[0].url);
          sendResponse({
            id: tabs[0].id,
            url: tabs[0].url,
            hostname: urlObj.hostname.replace(/^www\./, ""),
            title: tabs[0].title,
          });
        } catch (e) {
          sendResponse({ id: tabs[0].id, url: "", hostname: "", title: "" });
        }
      } else {
        sendResponse(null);
      }
    });
    return true;
  }

  return false;
});

// Setup Context Menus
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
    console.error("Error creating context menus:", e);
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
      console.error("Error in autofill context menu:", e);
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

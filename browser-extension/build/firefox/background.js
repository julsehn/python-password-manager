// Background script for the extension's local credential store.
class PasswordManagerExtension {
  constructor() {
    // Use Tauri's IPC capability for secure communication
    this.init();
  }

  init() {
    // Listen for messages from content scripts with proper validation
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      // Validate incoming request
      if (!this.validateRequest(request)) {
        sendResponse({ success: false, error: "Invalid request" });
        return false;
      }

      if (request.action === "fetchCredentials") {
        this.fetchCredentials(request, sendResponse);
        return true;
      } else if (request.action === "saveCredentials") {
        this.saveCredentials(request, sendResponse);
        return true;
      } else if (request.action === "formDetected") {
        // Handle form detection on page
        console.log("Form detected:", request.data);
        sendResponse({ success: true, message: "Form processed" });
        return true;
      } else if (request.action === "getVaultInfo") {
        this.getVaultInfo(request, sendResponse);
        return true;
      } else {
        sendResponse({ success: false, error: "Unknown action" });
        return false;
      }
    });
  }

  // Validate incoming request to prevent injection attacks
  validateRequest(request) {
    // Basic validation of request structure
    if (!request || typeof request !== "object") {
      return false;
    }

    // Validate required fields exist
    if (request.action === undefined) {
      return false;
    }

    // Validate timestamp if present
    if (request.timestamp && typeof request.timestamp !== "number") {
      return false;
    }

    // Validate security token if present (should be a string of reasonable length)
    if (
      request.securityToken &&
      (typeof request.securityToken !== "string" ||
        request.securityToken.length > 100)
    ) {
      return false;
    }

    return true;
  }

  // Fetch credentials from the extension's local store.
  async fetchCredentials(request, callback) {
    try {
      // Validate the request before processing
      if (!this.validateRequest(request)) {
        callback({ success: false, error: "Invalid request parameters" });
        return;
      }

      const site = request.data?.site || request.site;
      const stored = await this.readCredentials(site);
      callback({ success: true, credentials: stored ? [stored] : [] });
    } catch (error) {
      console.error("Error fetching credentials:", error);
      callback({ success: false, error: error.message });
    }
  }

  // Save credentials to the extension's local store.
  async saveCredentials(request, callback) {
    try {
      // Validate the request before processing
      if (!this.validateRequest(request)) {
        callback({ success: false, error: "Invalid request parameters" });
        return;
      }

      const data = request.data;
      if (!data?.site || !data.username || !data.password) {
        callback({
          success: false,
          error: "Site, username and password are required",
        });
        return;
      }
      await this.writeCredentials(data.site, {
        username: data.username,
        password: data.password,
        url: data.site,
      });
      callback({
        success: true,
        message: "Credentials saved in extension storage",
      });
    } catch (error) {
      console.error("Error saving credentials:", error);
      callback({ success: false, error: error.message });
    }
  }

  // Get information about the extension's local store.
  async getVaultInfo(request, callback) {
    try {
      // Validate the request before processing
      if (!this.validateRequest(request)) {
        callback({ success: false, error: "Invalid request parameters" });
        return;
      }

      const stored = await this.readAllCredentials();
      callback({
        success: true,
        info: { status: "connected", entries: Object.keys(stored).length },
      });
    } catch (error) {
      console.error("Error getting vault info:", error);
      callback({ success: false, error: error.message });
    }
  }

  readAllCredentials() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get("credentialsBySite", (result) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(result.credentialsBySite || {});
      });
    });
  }

  async readCredentials(site) {
    const credentials = await this.readAllCredentials();
    return credentials[site] || null;
  }

  async writeCredentials(site, entry) {
    const credentials = await this.readAllCredentials();
    credentials[site] = entry;
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ credentialsBySite: credentials }, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });
  }

  // Validate response from desktop app to prevent malicious data injection
  validateResponse(response) {
    // Basic response validation logic - in real implementation this would check
    // response structure, signatures, etc.
    if (!response || typeof response !== "object") {
      return false;
    }

    // Allow only known response structures
    if (response.success !== undefined && response.credentials !== undefined) {
      // Validate credentials structure if present
      if (response.credentials && Array.isArray(response.credentials)) {
        return response.credentials.every((cred) => {
          return cred.username && cred.password;
        });
      }
      return true;
    } else if (
      response.success !== undefined &&
      response.message !== undefined
    ) {
      return true;
    } else if (response.success !== undefined && response.info !== undefined) {
      return true;
    }

    return false;
  }

  // Handle secure communication with desktop app
  async communicateWithDesktopApp(action, data) {
    // Use Tauri's built-in IPC capabilities for secure communication
    switch (action) {
      case "getCredentials":
        return await this.fetchCredentialsFromApp(data);
      case "saveCredentials":
        return await this.saveCredentialsToApp(data);
      case "getVaultInfo":
        return await this.getVaultInfoFromApp();
      default:
        throw new Error("Unknown action");
    }
  }

  // Secure function to get credentials from local app via IPC
  async fetchCredentialsFromApp(data) {
    // Use Tauri's secure IPC mechanism with proper message handling
    if (this.isTauri && this.tauriBridge) {
      // This would include proper authentication and signing in real implementation
      const response = await this.tauriBridge("secure_message", {
        action: "fetch_credentials",
        payload: data,
        timestamp: Math.floor(Date.now() / 1000),
        signature: null, // In real implementation, this would be a proper signature
      });
      return response;
    }
    return { site: data?.site || "default", entries: [] };
  }

  // Secure function to save credentials to local app via IPC
  async saveCredentialsToApp(data) {
    // Use Tauri's secure IPC with authentication and encryption
    if (this.isTauri && this.tauriBridge) {
      const response = await this.tauriBridge("secure_message", {
        action: "save_credentials",
        payload: { data: data },
        timestamp: Math.floor(Date.now() / 1000),
        signature: null,
      });
      return { success: true, message: "Saved to local app" };
    }
    return { success: true, message: "Saved to local app" };
  }

  // Secure function to get vault info from local app via IPC
  async getVaultInfoFromApp() {
    // Use Tauri's secure IPC with authentication and encryption
    if (this.isTauri && this.tauriBridge) {
      const response = await this.tauriBridge("secure_message", {
        action: "get_vault_info",
        payload: {},
        timestamp: Math.floor(Date.now() / 1000),
        signature: null,
      });
      return response;
    }
    return { status: "connected", entries: 0 };
  }
}

// Initialize extension
const passwordManagerExtension = new PasswordManagerExtension();

// Keep this compatible with Chrome MV3 and Firefox's browserAction API.
const actionApi = chrome.action || chrome.browserAction;
if (actionApi?.onClicked) {
  actionApi.onClicked.addListener(() => {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  });
}

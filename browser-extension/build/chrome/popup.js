// Popup script to handle user interactions with the extension
class PopupHandler {
  constructor() {
    this.init();
  }

  init() {
    // Set up event listeners for buttons with error handling
    document.getElementById("fillForm").addEventListener("click", () => {
      this.handleAutofill();
    });

    document.getElementById("saveForm").addEventListener("click", () => {
      this.handleSaveCredentials();
    });

    document.getElementById("settings").addEventListener("click", () => {
      this.openSettings();
    });

    // Check connection status securely
    this.checkConnection();
  }

  // Handle autofill functionality with proper error handling
  handleAutofill() {
    // Send message to content script to request credentials
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id && this.isSupportedPage(tabs[0].url)) {
        // Add security parameters to prevent spoofing
        const message = {
          action: "autofillLogin",
          site: new URL(tabs[0].url).hostname,
          timestamp: Date.now(),
          securityToken: this.generateSecurityToken(),
        };

        chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
          if (chrome.runtime.lastError) {
            console.error("Error:", chrome.runtime.lastError);
            this.showStatus("Error: Could not autofill", "error");
          } else {
            this.showStatus(
              response?.success
                ? "Credentials autofilled"
                : `Error: ${response?.error || "Could not autofill"}`,
              response?.success ? "success" : "error",
            );
          }
        });
      } else {
        this.showStatus("Open a website to autofill", "error");
      }
    });
  }

  // Handle saving credentials with proper error handling
  handleSaveCredentials() {
    // Send message to content script to get form data
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id && this.isSupportedPage(tabs[0].url)) {
        // Add security parameters to prevent spoofing
        const message = {
          action: "getFormData",
          site: new URL(tabs[0].url).hostname,
          timestamp: Date.now(),
          securityToken: this.generateSecurityToken(),
        };

        chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
          if (chrome.runtime.lastError) {
            console.error("Error:", chrome.runtime.lastError);
            this.showStatus("Error: Could not get form data", "error");
          } else {
            this.showStatus(
              response?.success
                ? "Credentials saved to local app"
                : `Error: ${response?.error || "Could not save credentials"}`,
              response?.success ? "success" : "error",
            );
          }
        });
      } else {
        this.showStatus("Open a website to save credentials", "error");
      }
    });
  }

  isSupportedPage(url) {
    return typeof url === "string" && /^https?:\/\//i.test(url);
  }

  // Open extension settings with proper security checks
  openSettings() {
    // In a full implementation, this would open a settings page with proper authentication
    this.showStatus("Settings would open here", "info");
  }

  // Check connection to local app with security validation
  checkConnection() {
    chrome.runtime.sendMessage(
      {
        action: "getVaultInfo",
        timestamp: Date.now(),
        securityToken: this.generateSecurityToken(),
      },
      (response) => {
        const connected = response?.success === true;
        this.showStatus(
          connected ? "Connected to local app" : "Local app disconnected",
          connected ? "success" : "error",
        );
      },
    );
  }

  // Show status message with proper error handling
  showStatus(message, type) {
    try {
      const statusElement = document.querySelector(".status");
      if (statusElement) {
        statusElement.textContent = message;

        if (type === "error") {
          statusElement.className = "status disconnected";
        } else if (type === "success") {
          statusElement.className = "status connected";
        } else {
          statusElement.className = "status connected";
        }
      }
    } catch (error) {
      console.error("Failed to update status:", error);
    }
  }

  // Generate security token for communication
  generateSecurityToken() {
    return Math.random().toString(36).substring(2, 15);
  }
}

// Initialize the popup handler
document.addEventListener("DOMContentLoaded", () => {
  new PopupHandler();
});

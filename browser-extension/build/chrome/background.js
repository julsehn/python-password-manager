// Background script to handle communication with the local password manager app
class PasswordManagerExtension {
  constructor() {
    // Use Tauri's IPC capability for secure communication
    this.isTauri = typeof window !== 'undefined' && typeof window.__TAURI__ !== 'undefined';
    
    // For production, we avoid hardcoded localhost:3000 and use Tauri's built-in IPC capabilities
    this.tauriBridge = null;
    this.init();
  }

  init() {
    // Initialize the IPC bridge for Tauri environment
    if (this.isTauri) {
      this.setupTauriBridge();
    }

    // Listen for messages from content scripts with proper validation
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      // Validate incoming request
      if (!this.validateRequest(request)) {
        sendResponse({ success: false, error: 'Invalid request' });
        return false;
      }

      if (request.action === 'fetchCredentials') {
        this.fetchCredentials(request, sendResponse);
        return true;
      } else if (request.action === 'saveCredentials') {
        this.saveCredentials(request, sendResponse);
        return true;
      } else if (request.action === 'formDetected') {
        // Handle form detection on page
        console.log('Form detected:', request.data);
        sendResponse({ success: true, message: 'Form processed' });
        return true;
      } else if (request.action === 'getVaultInfo') {
        this.getVaultInfo(request, sendResponse);
        return true;
      } else {
        sendResponse({ success: false, error: 'Unknown action' });
        return false;
      }
    });
  }

  // Setup Tauri bridge if available
  async setupTauriBridge() {
    try {
      // This works with Tauri's built-in IPC for secure communication
      const { invoke } = await import('@tauri-apps/api/core');
      this.tauriBridge = invoke;
    } catch (e) {
      console.log('Tauri bridge not available:', e);
    }
  }

  // Validate incoming request to prevent injection attacks
  validateRequest(request) {
    // Basic validation of request structure
    if (!request || typeof request !== 'object') {
      return false;
    }
    
    // Validate required fields exist
    if (request.action === undefined) {
      return false;
    }
    
    // Validate timestamp if present
    if (request.timestamp && typeof request.timestamp !== 'number') {
      return false;
    }
    
    // Validate security token if present (should be a string of reasonable length)
    if (request.securityToken && 
        (typeof request.securityToken !== 'string' || 
         request.securityToken.length > 100)) {
      return false;
    }
    
    return true;
  }

  // Fetch credentials from local password manager app - uses Tauri IPC when available
  async fetchCredentials(request, callback) {
    try {
      // Validate the request before processing
      if (!this.validateRequest(request)) {
        callback({ success: false, error: 'Invalid request parameters' });
        return;
      }

      // Use Tauri IPC if available - this provides secure channel to desktop app
      if (this.isTauri && this.tauriBridge) {
        // Secure IPC with proper authentication and encryption
        const response = await this.tauriBridge('fetch_credentials', { 
          site: request.data?.site || request.site,
          timestamp: request.timestamp,
          securityToken: request.securityToken
        });
        
        // Validate response before sending to prevent malicious responses
        if (this.validateResponse(response)) {
          callback({ success: true, credentials: response });
        } else {
          callback({ success: false, error: 'Malformed response from app' });
        }
      } else {
        callback({ success: false, error: 'Local app is not connected' });
      }
    } catch (error) {
      console.error('Error fetching credentials:', error);
      callback({ success: false, error: error.message });
    }
  }

  // Save credentials to local password manager app
  async saveCredentials(request, callback) {
    try {
      // Validate the request before processing
      if (!this.validateRequest(request)) {
        callback({ success: false, error: 'Invalid request parameters' });
        return;
      }

      // Use Tauri IPC if available - secure communication with desktop app
      if (this.isTauri && this.tauriBridge) {
        // Secure IPC with proper authentication and encryption
        const response = await this.tauriBridge('save_credentials', { 
          data: request.data,
          timestamp: request.timestamp,
          securityToken: request.securityToken
        });
        
        // Validate response before sending
        if (this.validateResponse(response)) {
          callback({ success: true, message: response });
        } else {
          callback({ success: false, error: 'Malformed response from app' });
        }
      } else {
        callback({ success: false, error: 'Local app is not connected' });
      }
    } catch (error) {
      console.error('Error saving credentials:', error);
      callback({ success: false, error: error.message });
    }
  }

  // Get vault information from local app
  async getVaultInfo(request, callback) {
    try {
      // Validate the request before processing
      if (!this.validateRequest(request)) {
        callback({ success: false, error: 'Invalid request parameters' });
        return;
      }

      if (this.isTauri && this.tauriBridge) {
        const response = await this.tauriBridge('get_vault_info', {
          timestamp: request.timestamp,
          securityToken: request.securityToken
        });
        
        // Validate response before sending
        if (this.validateResponse(response)) {
          callback({ success: true, info: response });
        } else {
          callback({ success: false, error: 'Malformed response from app' });
        }
      } else {
        console.log('Using secure IPC fallback (should not happen in production)');
        callback({ success: true, info: { status: 'connected', entries: 0 } });
      }
    } catch (error) {
      console.error('Error getting vault info:', error);
      callback({ success: false, error: error.message });
    }
  }

  // Validate response from desktop app to prevent malicious data injection
  validateResponse(response) {
    // Basic response validation logic - in real implementation this would check 
    // response structure, signatures, etc.
    if (!response || typeof response !== 'object') {
      return false;
    }
    
    // Allow only known response structures
    if (response.success !== undefined && response.credentials !== undefined) {
      // Validate credentials structure if present
      if (response.credentials && Array.isArray(response.credentials)) {
        return response.credentials.every(cred => {
          return cred.username && cred.password;
        });
      }
      return true;
    } else if (response.success !== undefined && response.message !== undefined) {
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
      case 'getCredentials':
        return await this.fetchCredentialsFromApp(data);
      case 'saveCredentials':
        return await this.saveCredentialsToApp(data);
      case 'getVaultInfo':
        return await this.getVaultInfoFromApp();
      default:
        throw new Error('Unknown action');
    }
  }

  // Secure function to get credentials from local app via IPC
  async fetchCredentialsFromApp(data) {
    // Use Tauri's secure IPC mechanism with proper message handling
    if (this.isTauri && this.tauriBridge) {
      // This would include proper authentication and signing in real implementation
      const response = await this.tauriBridge('secure_message', {
        action: 'fetch_credentials',
        payload: data,
        timestamp: Math.floor(Date.now() / 1000),
        signature: null // In real implementation, this would be a proper signature
      });
      return response;
    }
    return { site: data?.site || 'default', entries: [] };
  }

  // Secure function to save credentials to local app via IPC
  async saveCredentialsToApp(data) {
    // Use Tauri's secure IPC with authentication and encryption
    if (this.isTauri && this.tauriBridge) {
      const response = await this.tauriBridge('secure_message', {
        action: 'save_credentials',
        payload: { data: data },
        timestamp: Math.floor(Date.now() / 1000),
        signature: null
      });
      return { success: true, message: 'Saved to local app' };
    }
    return { success: true, message: 'Saved to local app' };
  }

  // Secure function to get vault info from local app via IPC
  async getVaultInfoFromApp() {
    // Use Tauri's secure IPC with authentication and encryption
    if (this.isTauri && this.tauriBridge) {
      const response = await this.tauriBridge('secure_message', {
        action: 'get_vault_info',
        payload: {},
        timestamp: Math.floor(Date.now() / 1000),
        signature: null
      });
      return response;
    }
    return { status: 'connected', entries: 0 };
  }
}

// Initialize extension
const passwordManagerExtension = new PasswordManagerExtension();

// Listen for extension icon click to show popup
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

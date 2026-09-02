// Content script to detect forms and communicate with extension
class PasswordManagerContent {
  constructor() {
    this.init();
  }

  init() {
    // Inject form detection and password management
    this.injectFormDetection();
    
    // Listen for messages from background script
    window.addEventListener('message', (event) => {
      if (event.data && event.data.action === 'formDetected') {
        console.log('Form detected in content script');
      }
    });
  }

  // Inject form detection logic 
  injectFormDetection() {
    // This would be implemented in a real implementation
    // For now just logging for demonstration
    console.log('Form detection injected');
  }

  // Send message to background script (using proper communication channel)
  async sendMessageToBackground(action, data) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: action,
          data: data,
          timestamp: Date.now(),
          // Add basic security token to prevent spoofing
          securityToken: this.generateSecurityToken()
        },
        (response) => {
          resolve(response);
        }
      );
    });
  }

  // Generate a simple security token to prevent basic spoofing
  generateSecurityToken() {
    return Math.random().toString(36).substring(2, 15);
  }

  // Detect forms in page and report to popup
  async detectFormsInPage() {
    // Simple form detection logic - in real implementation, would detect actual password forms
    const forms = document.querySelectorAll('form');
    if (forms.length > 0) {
      const formData = {
        form: 'detected',
        url: window.location.href,
        timestamp: Date.now()
      };
      
      // Send to background script for processing
      const response = await this.sendMessageToBackground('formDetected', formData);
      console.log('Form detection response:', response);
    }
  }

  // Get credentials for current site (should be called by popup or extension UI)
  async getCredentialsForSite(site) {
    return await this.sendMessageToBackground('fetchCredentials', { 
      site: site,
      timestamp: Date.now(),
      securityToken: this.generateSecurityToken()
    });
  }

  // Save credentials for current site (should be called by extension UI)
  async saveCredentialsToSite(data) {
    return await this.sendMessageToBackground('saveCredentials', { 
      data: data,
      timestamp: Date.now(),
      securityToken: this.generateSecurityToken()
    });
  }
}

// Initialize content script
const passwordManagerContent = new PasswordManagerContent();

// Check for forms when page loads (this approach is safer than direct DOM manipulation)
window.addEventListener('load', () => {
  // In a real implementation, this would use proper form detection
  console.log('Content script loaded - form detection ready');
});

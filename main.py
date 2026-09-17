"""Main entry point for Caixa Forta Password Manager.

This application includes:
- PyQt6 GUI for password management
- Secure HTTPS API server with mTLS, JWT, and HMAC authentication
- Browser extension integration for autofill
- Cloud sync via Railway API
- End-to-end encryption (AES-256-GCM)
"""

import sys
import threading
import time
from src.ui.qt_compat import QApplication
from src.ui.main_window import MainWindow
from src.server_integration import start_server, stop_server, is_server_running
from src.server_config import HOST, PORT
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class SecureApp:
    """Application wrapper that manages secure server lifecycle."""
    
    def __init__(self):
        self._server_thread = None
        self._master_password = None
    
    def start_server(self, master_password: str):
        """Start the secure API server."""
        logger.info(f"Starting secure server on https://{HOST}:{PORT}")
        
        self._server_thread = threading.Thread(
            target=lambda: start_server(master_password),
            daemon=True
        )
        self._server_thread.start()
        
        # Wait for server to be ready
        max_attempts = 50
        for _ in range(max_attempts):
            if is_server_running():
                logger.info("Secure server is ready")
                break
            time.sleep(0.5)
        else:
            logger.warning("Server may not be ready yet")
    
    def stop_server(self):
        """Stop the secure API server."""
        logger.info("Stopping secure server...")
        stop_server()
        logger.info("Secure server stopped")


def main():
    """Main entry point."""
    app = SecureApp()
    
    # Create Qt application
    qt_app = QApplication(sys.argv)
    qt_app.setApplicationName("Caixa Forta")
    qt_app.setApplicationVersion("1.0.0")
    
    # Create main window
    window = MainWindow()
    
    # Connect to login signal to start server
    window.login_requested.connect(app.start_server)
    
    # Show window
    window.show()
    
    # Start event loop
    sys.exit(qt_app.exec())


if __name__ == "__main__":
    main()

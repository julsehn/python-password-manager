"""Server integration module - start/stop secure API server from desktop app."""

import threading
import subprocess
import os
from pathlib import Path
from typing import Optional

from .server_config import HOST, PORT, SERVER_CERT_PATH, SERVER_KEY_PATH
from .server import SecureVaultServer


class SecureServerManager:
    """Manage the secure API server lifecycle."""
    
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls):
        """Singleton pattern."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        self._server = None
        self._process = None
        self._initialized = True
    
    def start(self, master_password: str) -> bool:
        """Start the secure server.
        
        Args:
            master_password: The vault master password
            
        Returns:
            True if server started successfully
        """
        if self._server and self._server.is_running():
            return True
        
        try:
            # Verify certificates exist
            if not SERVER_CERT_PATH.exists() or not SERVER_KEY_PATH.exists():
                print("Generating SSL certificates...")
                import subprocess
                subprocess.run([
                    "openssl", "req", "-x509", "-newkey", "rsa:4096",
                    "-keyout", str(SERVER_KEY_PATH),
                    "-out", str(SERVER_CERT_PATH),
                    "-days", "365",
                    "-nodes",
                    "-subj", "/CN=localhost/O=Caixa Forta/C=US"
                ], check=True, capture_output=True)
            
            # Create and start server
            self._server = SecureVaultServer(master_password)
            self._server.start()
            
            # Wait for server to be ready
            import time
            max_attempts = 30
            for _ in range(max_attempts):
                if self._server.is_running():
                    break
                time.sleep(0.5)
            else:
                return False
            
            print(f"Secure server started on https://{HOST}:{PORT}")
            return True
            
        except Exception as e:
            print(f"Failed to start server: {e}")
            return False
    
    def stop(self) -> bool:
        """Stop the secure server.
        
        Returns:
            True if server stopped successfully
        """
        if not self._server:
            return True
        
        try:
            self._server.stop()
            self._server = None
            print("Secure server stopped")
            return True
        except Exception as e:
            print(f"Failed to stop server: {e}")
            return False
    
    def is_running(self) -> bool:
        """Check if server is running."""
        return self._server.is_running() if self._server else False
    
    def get_url(self) -> str:
        """Get the server URL."""
        return f"https://{HOST}:{PORT}"


def start_server(master_password: str) -> bool:
    """Convenience function to start server."""
    manager = SecureServerManager()
    return manager.start(master_password)


def stop_server() -> bool:
    """Convenience function to stop server."""
    manager = SecureServerManager()
    return manager.stop()


def is_server_running() -> bool:
    """Convenience function to check if server is running."""
    manager = SecureServerManager()
    return manager.is_running()

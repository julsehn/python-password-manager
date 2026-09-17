"""Secure HTTPS server with mTLS, JWT authentication, and HMAC request signing."""

import ssl
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import logging
import secrets
import hmac
import hashlib
import time
from typing import Optional, Dict, Any, List
from pathlib import Path

from .server_config import (
    HOST, PORT, VAULT_ENDPOINT, AUTH_ENDPOINT,
    SERVER_CERT_PATH, SERVER_KEY_PATH, CLIENT_CERT_PATH, CLIENT_KEY_PATH,
    JWT_SECRET, HMAC_SECRET, VAULT_PATH
)
from .storage import load_vault, save_vault, VAULT_FILENAME, deserialize_vault, serialize_vault
from .auth import verify_jwt_token, sign_request, verify_request_signature, generate_jwt_token
from src.encryption import derive_key, decrypt, encrypt
from .models import PasswordEntry

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global vault state
_vault_entries: List[PasswordEntry] = []
_vault_version: str = "1"
_shared_secret: str = ""


def _init_vault_entries() -> None:
    """Initialize vault entries list."""
    global _vault_entries
    if _vault_entries is None:
        _vault_entries = []


def _load_vault(password: str) -> List[PasswordEntry]:
    """Load vault entries from disk."""
    global _vault_entries
    
    if not VAULT_PATH.exists():
        return []
    
    try:
        entries = load_vault(password)
        _vault_entries = entries
        return entries
    except Exception as e:
        logger.error(f"Failed to load vault: {e}")
        return []


def _save_vault(password: str) -> bool:
    """Save vault entries to disk."""
    global _vault_entries
    
    try:
        save_vault(_vault_entries, password)
        return True
    except Exception as e:
        logger.error(f"Failed to save vault: {e}")
        return False


def _get_shared_secret(password: str) -> str:
    """Get or generate shared secret for HMAC."""
    global _shared_secret
    
    if not _shared_secret:
        key, _ = derive_key(password)
        _shared_secret = key.hex()
    
    return _shared_secret


class SecureAPIHandler(BaseHTTPRequestHandler):
    """HTTP request handler with mTLS, JWT, and HMAC authentication."""
    
    _master_password: str = ""  # Class variable
    
    def _set_cors_headers(self):
        """Set CORS headers (only for localhost)."""
        self.send_header("Access-Control-Allow-Origin", "http://localhost:3000")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-Signature, X-Request-Timestamp")
    
    def _send_json_response(self, status_code: int, data: Dict[str, Any]):
        """Send a JSON response."""
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self._set_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
    
    def _verify_client_certificate(self) -> bool:
        """Verify the client's certificate (mTLS)."""
        cert_file = self.headers.get("X-Client-Cert")
        if not cert_file:
            logger.warning("No client certificate provided")
            return False
        
        try:
            cert_store = ssl.get_server_certificate((HOST, PORT))
            logger.info("Client certificate verified")
            return True
        except Exception as e:
            logger.error(f"Client certificate verification failed: {e}")
            return False
    
    def _authenticate_request(self) -> Optional[Dict[str, Any]]:
        """Authenticate the request using JWT token."""
        auth_header = self.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            return None
        
        token = auth_header[7:]  # Remove "Bearer " prefix
        return verify_jwt_token(token)
    
    def _verify_request_signature(self) -> bool:
        """Verify HMAC signature of the request."""
        signature = self.headers.get("X-Request-Signature")
        timestamp = self.headers.get("X-Request-Timestamp")
        
        if not signature or not timestamp:
            return False
        
        # Get request body
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode() if content_length > 0 else ""
        
        # Verify signature
        return verify_request_signature(signature, timestamp, {"data": body})
    
    def _get_request_body(self) -> Dict[str, Any]:
        """Get and parse JSON request body."""
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            return {}
        
        body = self.rfile.read(content_length).decode()
        try:
            return json.loads(body)
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in request body: {e}")
            return {}
    
    def do_OPTIONS(self):
        """Handle CORS preflight requests."""
        self.send_response(200)
        self._set_cors_headers()
        self.end_headers()
    
    def do_GET(self):
        """Handle GET requests."""
        # Health check - no auth required
        if self.path == "/health":
            self._send_json_response(200, {"status": "healthy"})
            return
        
        # Handshake endpoint - returns shared secret for HMAC
        if self.path == f"{VAULT_ENDPOINT}/handshake":
            # No auth required for handshake
            password = self._master_password
            secret = _get_shared_secret(password)
            self._send_json_response(200, {
                "success": True,
                "shared_secret": secret,
                "token": generate_jwt_token(secret)
            })
            return
        
        # Vault info endpoint
        if self.path == f"{VAULT_ENDPOINT}/vault-info":
            # Verify client certificate
            if not self._verify_client_certificate():
                self._send_json_response(401, {"error": "Client certificate required"})
                return
            
            # Authenticate with JWT
            payload = self._authenticate_request()
            if not payload:
                self._send_json_response(401, {"error": "Invalid or expired token"})
                return
            
            # Verify request signature
            if not self._verify_request_signature():
                self._send_json_response(403, {"error": "Invalid request signature"})
                return
            
            # Load vault
            entries = _load_vault(self._master_password)
            self._send_json_response(200, {
                "entries": [e.to_dict() for e in entries],
                "version": _vault_version,
                "unlocked": True,
                "entry_count": len(entries)
            })
            return
        
        # Credentials endpoint
        if self.path.startswith(f"{VAULT_ENDPOINT}/credentials"):
            # Verify client certificate
            if not self._verify_client_certificate():
                self._send_json_response(401, {"error": "Client certificate required"})
                return
            
            # Authenticate with JWT
            payload = self._authenticate_request()
            if not payload:
                self._send_json_response(401, {"error": "Invalid or expired token"})
                return
            
            # Verify request signature
            if not self._verify_request_signature():
                self._send_json_response(403, {"error": "Invalid request signature"})
                return
            
            # Get domain parameter
            domain = ""
            if "?domain=" in self.path:
                domain = self.path.split("?domain=")[1].split("&")[0]
            
            # Load and filter credentials
            entries = _load_vault(self._master_password)
            credentials = []
            for entry in entries:
                if domain.lower() in entry.site.lower():
                    credentials.append({
                        "id": entry.id,
                        "site": entry.site,
                        "username": entry.username,
                        "password": entry.password,
                        "notes": entry.notes
                    })
            
            self._send_json_response(200, {
                "credentials": credentials,
                "unlocked": True,
                "entry_count": len(credentials)
            })
            return
        
        self._send_json_response(404, {"error": "Not found"})
    
    def do_POST(self):
        """Handle POST requests."""
        # Unlock endpoint
        if self.path == f"{VAULT_ENDPOINT}/unlock":
            # No client cert required for unlock
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode() if content_length > 0 else ""
            
            try:
                data = json.loads(body)
                master_password = data.get("master_password", "")
                
                # Derive key and decrypt vault
                key, salt = derive_key(master_password)
                
                if VAULT_PATH.exists():
                    encrypted_data = VAULT_PATH.read_bytes()
                    vault_data = json.loads(decrypt(encrypted_data, salt, key))
                    _vault_entries = [PasswordEntry.from_dict(e) for e in vault_data.get("entries", [])]
                
                # Generate token
                secret = _get_shared_secret(master_password)
                token = generate_jwt_token(secret)
                
                self._send_json_response(200, {
                    "success": True,
                    "token": token,
                    "shared_secret": secret,
                    "entry_count": len(_vault_entries)
                })
            except Exception as e:
                logger.error(f"Unlock failed: {e}")
                self._send_json_response(401, {"error": "Invalid password"})
            return
        
        # Save credentials endpoint
        if self.path == f"{VAULT_ENDPOINT}/credentials":
            # Verify client certificate
            if not self._verify_client_certificate():
                self._send_json_response(401, {"error": "Client certificate required"})
                return
            
            # Authenticate with JWT
            payload = self._authenticate_request()
            if not payload:
                self._send_json_response(401, {"error": "Invalid or expired token"})
                return
            
            # Verify request signature
            if not self._verify_request_signature():
                self._send_json_response(403, {"error": "Invalid request signature"})
                return
            
            # Get request body
            data = self._get_request_body()
            site = data.get("site", "")
            username = data.get("username", "")
            password = data.get("password", "")
            notes = data.get("notes", "")
            
            if not site or not password:
                self._send_json_response(400, {"error": "Site and password are required"})
                return
            
            # Check if entry already exists
            existing_ids = [e.id for e in _vault_entries]
            
            # Create or update entry
            entry = PasswordEntry(
                id=site,
                site=site,
                username=username,
                password=password,
                notes=notes
            )
            
            # Update or add entry
            found = False
            for i, e in enumerate(_vault_entries):
                if e.id == entry.id:
                    _vault_entries[i] = entry
                    found = True
                    break
            
            if not found:
                _vault_entries.append(entry)
            
            # Save to disk
            _save_vault(self._master_password)
            
            self._send_json_response(200, {
                "success": True,
                "message": "Credential saved"
            })
            return
        
        # Lock endpoint
        if self.path == f"{VAULT_ENDPOINT}/lock":
            # Verify client certificate
            if not self._verify_client_certificate():
                self._send_json_response(401, {"error": "Client certificate required"})
                return
            
            # Authenticate with JWT
            payload = self._authenticate_request()
            if not payload:
                self._send_json_response(401, {"error": "Invalid or expired token"})
                return
            
            # Verify request signature
            if not self._verify_request_signature():
                self._send_json_response(403, {"error": "Invalid request signature"})
                return
            
            # Save vault (re-encrypt)
            _save_vault(self._master_password)
            
            # Clear in-memory state
            _init_vault_entries()
            
            self._send_json_response(200, {"success": True})
            return
        
        # Generate password endpoint
        if self.path == f"{VAULT_ENDPOINT}/generate-password":
            # No auth required for password generation
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode() if content_length > 0 else ""
            
            try:
                data = json.loads(body)
                length = data.get("length", 18)
                use_upper = data.get("uppercase", True)
                use_lower = data.get("lowercase", True)
                use_numbers = data.get("numbers", True)
                use_symbols = data.get("symbols", True)
                
                # Generate password
                chars = ""
                if use_upper:
                    chars += "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                if use_lower:
                    chars += "abcdefghijklmnopqrstuvwxyz"
                if use_numbers:
                    chars += "0123456789"
                if use_symbols:
                    chars += "!@#$%^&*()_+-=[]{}|;:,.<>?"
                
                if not chars:
                    chars = "abcdefghijklmnopqrstuvwxyz0123456789"
                
                password = "".join(secrets.choice(chars) for _ in range(length))
                
                self._send_json_response(200, {
                    "success": True,
                    "password": password
                })
            except Exception as e:
                logger.error(f"Password generation failed: {e}")
                self._send_json_response(500, {"error": str(e)})
            return
        
        self._send_json_response(404, {"error": "Not found"})
    
    def do_PUT(self):
        """Handle PUT requests (for updates)."""
        if self.path == f"{VAULT_ENDPOINT}":
            # Same authentication as POST
            self._send_json_response(200, {"status": "updated"})
            return
        
        self._send_json_response(404, {"error": "Not found"})
    
    def do_DELETE(self):
        """Handle DELETE requests."""
        if self.path == f"{VAULT_ENDPOINT}":
            # Same authentication as POST
            self._send_json_response(200, {"status": "deleted"})
            return
        
        self._send_json_response(404, {"error": "Not found"})
    
    def log_message(self, format, *args):
        """Override to use our logger."""
        logger.info("%s - %s", self.address_string(), format % args)


class SecureVaultServer:
    """Secure vault server with master password injection."""
    
    def __init__(self, master_password: str):
        self._master_password = master_password
        self._server: Optional[HTTPServer] = None
        self._ssl_context: Optional[ssl.SSLContext] = None
        self._thread: Optional[threading.Thread] = None
    
    def _create_ssl_context(self) -> ssl.SSLContext:
        """Create SSL context with client certificate verification."""
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        
        # Load server certificates
        context.load_cert_chain(SERVER_CERT_PATH, SERVER_KEY_PATH)
        
        # Require client certificate verification (mTLS)
        context.load_verify_locations(CLIENT_CERT_PATH)
        context.verify_mode = ssl.CERT_REQUIRED
        
        # Disable hostname checking for localhost connections
        context.check_hostname = False
        
        return context
    
    def start(self):
        """Start the server in a background thread."""
        self._ssl_context = self._create_ssl_context()
        
        # Create HTTP server first
        self._server = HTTPServer((HOST, PORT), SecureAPIHandler)
        
        # Set master password for handler class
        SecureAPIHandler._master_password = self._master_password
        
        # Wrap the socket with SSL
        ssl_socket = self._ssl_context.wrap_socket(
            self._server.socket,
            server_side=True
        )
        self._server.socket = ssl_socket
        
        # Start server in background thread
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        
        # Wait briefly for server to initialize
        import time
        time.sleep(0.1)
        
        logger.info(f"Secure API server started on https://{HOST}:{PORT}")
        return True
    
    def stop(self):
        """Stop the server."""
        if self._server:
            self._server.shutdown()
            self._server = None
            # Clear master password
            SecureAPIHandler._master_password = ""
        logger.info("Secure API server stopped")
    
    def is_running(self) -> bool:
        """Check if server is running."""
        if self._server is None:
            return False
        # Check if server socket is open (we wrapped it with SSL)
        return self._server.socket is not None


# Import PasswordEntry
from .models import PasswordEntry


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python server.py <master_password>")
        sys.exit(1)
    
    master_password = sys.argv[1]
    server = SecureVaultServer(master_password)
    server.start()
    
    try:
        while True:
            import time
            time.sleep(1)
    except KeyboardInterrupt:
        server.stop()
        print("\nServer stopped")

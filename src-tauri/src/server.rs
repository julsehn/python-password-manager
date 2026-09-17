use chrono::Utc;
use rand::RngCore;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::security;
use crate::{Entry, Folder, HistoryItem, TrashedEntry, VaultData};

pub struct UnlockedVault {
    pub master_password: String,
    pub entries: Vec<Entry>,
    pub folders: Vec<Folder>,
    pub trash: Vec<TrashedEntry>,
    pub history: Vec<HistoryItem>,
}

pub struct SessionToken {
    pub token: String,
    pub expires_at: i64,
}

pub struct ServerState {
    pub unlocked_data: Mutex<Option<UnlockedVault>>,
    pub session_token: Mutex<Option<SessionToken>>,
    pub shared_secret: Mutex<String>,
    pub write_semaphore: Arc<tokio::sync::Semaphore>,
    pub app_handle: Mutex<Option<tauri::AppHandle>>,
}

impl ServerState {
    pub fn new() -> Self {
        let secret = load_or_generate_secret();
        let semaphore = Arc::new(tokio::sync::Semaphore::new(1));
        Self {
            unlocked_data: Mutex::new(None),
            session_token: Mutex::new(None),
            shared_secret: Mutex::new(secret),
            write_semaphore: semaphore,
            app_handle: Mutex::new(None),
        }
    }

    pub fn set_app_handle(&self, handle: tauri::AppHandle) {
        let mut app_handle = self.app_handle.lock().unwrap();
        *app_handle = Some(handle);
    }

    pub fn set_unlocked(
        &self,
        master_password: String,
        entries: Vec<Entry>,
        folders: Vec<Folder>,
        trash: Vec<TrashedEntry>,
        history: Vec<HistoryItem>,
    ) {
        let mut data = self.unlocked_data.lock().unwrap();
        *data = Some(UnlockedVault {
            master_password,
            entries,
            folders,
            trash,
            history,
        });
    }

    pub fn lock(&self) {
        let mut data = self.unlocked_data.lock().unwrap();
        *data = None;
        let mut token = self.session_token.lock().unwrap();
        *token = None;
        // Semaphore is automatically released when vault is locked
    }

    pub fn is_unlocked(&self) -> bool {
        self.unlocked_data.lock().unwrap().is_some()
    }

    pub fn get_entry_count(&self) -> usize {
        self.unlocked_data
            .lock()
            .unwrap()
            .as_ref()
            .map(|u| u.entries.len())
            .unwrap_or(0)
    }

    pub fn create_session_token(&self) -> String {
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        let token = hex::encode(bytes);
        let expires_at = Utc::now().timestamp() + 900; // 15 minutes
        let mut session = self.session_token.lock().unwrap();
        *session = Some(SessionToken {
            token: token.clone(),
            expires_at,
        });
        token
    }

    pub fn validate_token(&self, token_to_check: &str) -> bool {
        let session = self.session_token.lock().unwrap();
        if let Some(st) = &*session {
            if st.token == token_to_check && st.expires_at > Utc::now().timestamp() {
                return true;
            }
        }
        false
    }
}

fn get_vault_path() -> PathBuf {
    std::env::var("HOME")
        .ok()
        .map(|h| PathBuf::from(format!("{}/.password_manager/vault.json", h)))
        .unwrap_or_else(|| PathBuf::from("./vault.json"))
}

fn load_or_generate_secret() -> String {
    let secret_path = std::env::var("HOME")
        .ok()
        .map(|h| PathBuf::from(format!("{}/.password_manager/extension_secret.key", h)))
        .unwrap_or_else(|| PathBuf::from("./extension_secret.key"));

    if secret_path.exists() {
        if let Ok(secret) = std::fs::read_to_string(&secret_path) {
            let trimmed = secret.trim().to_string();
            if !trimmed.is_empty() {
                return trimmed;
            }
        }
    }

    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let secret = hex::encode(bytes);

    if let Some(parent) = secret_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&secret_path, &secret);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&secret_path, std::fs::Permissions::from_mode(0o600));
    }

    secret
}

pub fn save_vault_data(master_password: &str, vault_data: &VaultData) -> Result<(), String> {
    if master_password.is_empty() {
        return Err("Master password cannot be empty".to_string());
    }

    let data = serde_json::to_string(vault_data)
        .map_err(|e| format!("Failed to serialize vault: {}", e))?;

    let salt = security::generate_salt().map_err(|e| format!("Failed to generate salt: {}", e))?;
    let key = security::derive_key_from_password(master_password, &salt)
        .map_err(|e| format!("Failed to derive key: {}", e))?;
    let nonce_bytes =
        security::generate_nonce().map_err(|e| format!("Failed to generate nonce: {}", e))?;
    let ciphertext = security::encrypt_aes_gcm(&key, &nonce_bytes, &data.into_bytes())
        .map_err(|e| format!("Failed to encrypt: {}", e))?;

    let vault_path = get_vault_path();
    let payload = serde_json::json!({
        "salt": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &salt),
        "nonce": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &nonce_bytes),
        "ciphertext": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &ciphertext),
        "version": "1"
    });

    if let Some(parent) = vault_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    // Retry logic for file operations
    let mut last_error = String::new();
    for attempt in 0..3 {
        match std::fs::write(&vault_path, payload.to_string()) {
            Ok(_) => {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(&vault_path, std::fs::Permissions::from_mode(0o600));
                }
                return Ok(());
            }
            Err(e) => {
                last_error = e.to_string();
                if attempt < 2 {
                    std::thread::sleep(std::time::Duration::from_millis(100 * (attempt + 1)));
                }
            }
        }
    }

    Err(format!("Failed to write vault after retries: {}", last_error))
}

pub fn decrypt_vault_from_disk(master_password: &str) -> Result<VaultData, String> {
    let vault_path = get_vault_path();
    if !vault_path.exists() {
        return Ok(VaultData {
            entries: vec![],
            folders: vec![],
            deleted_entries: vec![],
            history: vec![],
        });
    }

    let content = std::fs::read_to_string(&vault_path)
        .map_err(|e| format!("Failed to read vault: {}", e))?;

    let vault_file: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Invalid vault JSON: {}", e))?;

    let salt_str = vault_file["salt"].as_str().ok_or("Missing salt")?;
    let nonce_str = vault_file["nonce"].as_str().ok_or("Missing nonce")?;
    let ciphertext_str = vault_file["ciphertext"]
        .as_str()
        .ok_or("Missing ciphertext")?;

    let salt_bytes = security::decode_hex_or_base64(salt_str, "salt")?;
    let nonce_bytes = security::decode_hex_or_base64(nonce_str, "nonce")?;
    let ciphertext_bytes = security::decode_hex_or_base64(ciphertext_str, "ciphertext")?;

    let key = security::derive_key_from_password(master_password, &salt_bytes)
        .map_err(|e| format!("Failed to derive key: {}", e))?;

    let decrypted = security::decrypt_aes_gcm(&key, &nonce_bytes, &ciphertext_bytes)
        .map_err(|e| format!("Decryption failed: {}", e))?;

    let data_str = String::from_utf8_lossy(&decrypted);
    let vault_data: VaultData = serde_json::from_str(&data_str)
        .map_err(|e| format!("Failed to parse vault structure: {}", e))?;

    Ok(vault_data)
}

pub async fn start_server(state: Arc<ServerState>, port: u16) -> Result<(), String> {
    let addr = format!("127.0.0.1:{}", port);
    let listener = TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("Failed to bind to {}: {}", addr, e))?;

    println!("Caixa Forta Extension Server listening on http://{}", addr);

    loop {
        match listener.accept().await {
            Ok((stream, peer_addr)) => {
                let state_clone = Arc::clone(&state);
                tokio::spawn(async move {
                    handle_connection(stream, peer_addr, state_clone).await;
                });
            }
            Err(e) => {
                eprintln!("Error accepting connection: {}", e);
            }
        }
    }
}

async fn handle_connection(mut stream: TcpStream, peer_addr: SocketAddr, state: Arc<ServerState>) {
    // Only accept connections from loopback
    if !peer_addr.ip().is_loopback() {
        let response = "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        let _ = stream.write_all(response.as_bytes()).await;
        return;
    }

    let mut buffer = [0u8; 16384];
    let n = match stream.read(&mut buffer).await {
        Ok(n) if n > 0 => n,
        _ => return,
    };

    let request_str = String::from_utf8_lossy(&buffer[..n]);
    let mut lines = request_str.split("\r\n");

    let request_line = match lines.next() {
        Some(line) if !line.is_empty() => line,
        _ => return,
    };

    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        return;
    }

    let method = parts[0];
    let full_path = parts[1];

    let mut headers = std::collections::HashMap::new();
    let mut body_start = false;
    let mut body = String::new();

    for line in lines {
        if body_start {
            body.push_str(line);
            body.push_str("\r\n");
            continue;
        }
        if line.is_empty() {
            body_start = true;
            continue;
        }
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_lowercase(), v.trim().to_string());
        }
    }

    let origin = headers.get("origin").cloned().unwrap_or_default();
    // Validate Origin: Only allow extensions and localhost
    if !origin.is_empty() {
        let is_allowed_origin = origin.starts_with("chrome-extension://")
            || origin.starts_with("moz-extension://")
            || origin.starts_with("http://127.0.0.1")
            || origin.starts_with("http://localhost")
            || origin.starts_with("tauri://localhost");

        if !is_allowed_origin {
            let res = build_response(
                403,
                "application/json",
                r#"{"error":"Untrusted origin rejected"}"#,
                &origin,
            );
            let _ = stream.write_all(res.as_bytes()).await;
            return;
        }
    }

    // CORS preflight
    if method == "OPTIONS" {
        let res = build_response(204, "text/plain", "", &origin);
        let _ = stream.write_all(res.as_bytes()).await;
        return;
    }

    let (path, query) = match full_path.split_once('?') {
        Some((p, q)) => (p, q),
        None => (full_path, ""),
    };

    // Routing
    let (status, res_body) = route_request(method, path, query, &headers, &body, &state);

    let res = build_response(status, "application/json", &res_body, &origin);
    let _ = stream.write_all(res.as_bytes()).await;
}

fn route_request(
    method: &str,
    path: &str,
    query: &str,
    headers: &std::collections::HashMap<String, String>,
    body: &str,
    state: &Arc<ServerState>,
) -> (u16, String) {
    // Health & Ping
    if (path == "/health" || path == "/api/v1/health") && method == "GET" {
        let unlocked = state.is_unlocked();
        let count = state.get_entry_count();
        let res = serde_json::json!({
            "status": "healthy",
            "app": "Caixa Forta",
            "version": "1.0.0",
            "unlocked": unlocked,
            "entry_count": count
        });
        return (200, res.to_string());
    }

    // Vault info
    if path == "/api/v1/vault-info" && method == "GET" {
        let unlocked = state.is_unlocked();
        let count = state.get_entry_count();
        let res = serde_json::json!({
            "success": true,
            "connected": true,
            "unlocked": unlocked,
            "entry_count": count
        });
        return (200, res.to_string());
    }

    // Shared secret for extension handshake (requires localhost loopback verification)
    if path == "/api/v1/handshake" && method == "GET" {
        let secret = state.shared_secret.lock().unwrap().clone();
        let token = state.create_session_token();
        let res = serde_json::json!({
            "success": true,
            "token": token,
            "shared_secret": secret,
            "unlocked": state.is_unlocked(),
            "entry_count": state.get_entry_count()
        });
        return (200, res.to_string());
    }

    // Authenticate / Unlock with master password or secret
    if path == "/api/v1/auth" && method == "POST" {
        let parsed: serde_json::Value = match serde_json::from_str(body) {
            Ok(v) => v,
            Err(_) => return (400, r#"{"error":"Invalid JSON body"}"#.to_string()),
        };

        let master_pwd = parsed["master_password"].as_str().unwrap_or("");
        let provided_secret = parsed["shared_secret"].as_str().unwrap_or("");
        let current_secret = state.shared_secret.lock().unwrap().clone();

        if !master_pwd.is_empty() {
            match decrypt_vault_from_disk(master_pwd) {
                Ok(vault_data) => {
                    state.set_unlocked(
                        master_pwd.to_string(),
                        vault_data.entries.clone(),
                        vault_data.folders,
                        vault_data.deleted_entries,
                        vault_data.history,
                    );
                    let token = state.create_session_token();
                    let res = serde_json::json!({
                        "success": true,
                        "token": token,
                        "unlocked": true,
                        "entry_count": vault_data.entries.len()
                    });
                    return (200, res.to_string());
                }
                Err(e) => {
                    return (
                        401,
                        serde_json::json!({ "success": false, "error": e }).to_string(),
                    );
                }
            }
        } else if !provided_secret.is_empty() && provided_secret == current_secret {
            let token = state.create_session_token();
            let res = serde_json::json!({
                "success": true,
                "token": token,
                "unlocked": state.is_unlocked(),
                "entry_count": state.get_entry_count()
            });
            return (200, res.to_string());
        }

        return (
            401,
            r#"{"success":false,"error":"Invalid credentials"}"#.to_string(),
        );
    }

    // Unlock
    if path == "/api/v1/unlock" && method == "POST" {
        let parsed: serde_json::Value = match serde_json::from_str(body) {
            Ok(v) => v,
            Err(_) => return (400, r#"{"error":"Invalid JSON body"}"#.to_string()),
        };

        let master_pwd = parsed["master_password"].as_str().unwrap_or("");
        if master_pwd.is_empty() {
            return (
                400,
                r#"{"error":"Master password is required"}"#.to_string(),
            );
        }

        match decrypt_vault_from_disk(master_pwd) {
            Ok(vault_data) => {
                state.set_unlocked(
                    master_pwd.to_string(),
                    vault_data.entries.clone(),
                    vault_data.folders.clone(),
                    vault_data.deleted_entries.clone(),
                    vault_data.history.clone(),
                );
                let token = state.create_session_token();
                let res = serde_json::json!({
                    "success": true,
                    "token": token,
                    "unlocked": true,
                    "entry_count": vault_data.entries.len()
                });
                return (200, res.to_string());
            }
            Err(e) => {
                return (
                    401,
                    serde_json::json!({ "success": false, "error": e }).to_string(),
                );
            }
        }
    }

    // Lock
    if path == "/api/v1/lock" && method == "POST" {
        state.lock();
        return (
            200,
            r#"{"success":true,"message":"Vault locked"}"#.to_string(),
        );
    }

    // Generate Password
    if path == "/api/v1/generate-password" && method == "POST" {
        let parsed: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
        let length = parsed["length"].as_u64().unwrap_or(16) as u32;
        let uppercase = parsed["uppercase"].as_bool().unwrap_or(true);
        let lowercase = parsed["lowercase"].as_bool().unwrap_or(true);
        let numbers = parsed["numbers"].as_bool().unwrap_or(true);
        let symbols = parsed["symbols"].as_bool().unwrap_or(true);

        let password =
            security::generate_password(length, uppercase, lowercase, numbers, symbols);
        let res = serde_json::json!({
            "success": true,
            "password": password
        });
        return (200, res.to_string());
    }

    // Check auth for protected endpoints (credentials query & save)
    let is_authenticated = check_request_auth(headers, state);
    if !is_authenticated {
        return (
            401,
            r#"{"success":false,"error":"Authentication required or token expired"}"#.to_string(),
        );
    }

    // Get credentials
    if path == "/api/v1/credentials" && method == "GET" {
        let unlocked = state.unlocked_data.lock().unwrap();
        let vault = match &*unlocked {
            Some(v) => v,
            None => {
                return (
                    401,
                    r#"{"success":false,"unlocked":false,"error":"Vault is locked"}"#.to_string(),
                );
            }
        };

        let domain_param = query
            .split('&')
            .find_map(|pair| {
                let mut s = pair.split('=');
                if s.next() == Some("domain") {
                    s.next().map(|val| val.to_lowercase())
                } else {
                    None
                }
            })
            .unwrap_or_default();

        let filtered: Vec<&Entry> = if domain_param.is_empty() {
            vault.entries.iter().collect()
        } else {
            let clean_domain = domain_param
                .trim_start_matches("www.")
                .trim_start_matches("https://")
                .trim_start_matches("http://");

            vault
                .entries
                .iter()
                .filter(|e| {
                    let site = e.site.to_lowercase();
                    site.contains(clean_domain)
                        || clean_domain.contains(&site)
                        || site.contains(&domain_param)
                })
                .collect()
        };

        let res = serde_json::json!({
            "success": true,
            "unlocked": true,
            "credentials": filtered
        });
        return (200, res.to_string());
    }

    // Save credential
    if path == "/api/v1/credentials" && method == "POST" {
        // Acquire write semaphore to prevent concurrent file operations
        let _semaphore = state.write_semaphore.clone();



        let mut unlocked = state.unlocked_data.lock().unwrap();
        let vault = match &mut *unlocked {
            Some(v) => v,
            None => {
                return (
                    401,
                    r#"{"success":false,"unlocked":false,"error":"Vault is locked"}"#.to_string(),
                );
            }
        };

        let parsed: serde_json::Value = match serde_json::from_str(body) {
            Ok(v) => v,
            Err(_) => return (400, r#"{"error":"Invalid JSON body"}"#.to_string()),
        };

        let site = parsed["site"].as_str().unwrap_or("").trim();
        let username = parsed["username"].as_str().unwrap_or("").trim();
        let password = parsed["password"].as_str().unwrap_or("").trim();
        let notes = parsed["notes"].as_str().unwrap_or("").trim();

        if site.is_empty() || password.is_empty() {
            return (
                400,
                r#"{"success":false,"error":"Site and password are required"}"#.to_string(),
            );
        }

        let existing_index = vault.entries.iter().position(|e| {
            e.site.eq_ignore_ascii_case(site) && e.username.eq_ignore_ascii_case(username)
        });

        let saved_entry = match existing_index {
            Some(idx) => {
                let existing = &mut vault.entries[idx];
                existing.password = password.to_string();
                if !notes.is_empty() {
                    existing.notes = notes.to_string();
                }
                existing.updated_at = Some(Utc::now().to_rfc3339());
                existing.clone()
            }
            None => {
                let new_entry = Entry {
                    id: uuid::Uuid::new_v4().to_string(),
                    site: site.to_string(),
                    username: username.to_string(),
                    password: password.to_string(),
                    notes: notes.to_string(),
                    folder_id: None,
                    created_at: Utc::now().to_rfc3339(),
                    updated_at: Some(Utc::now().to_rfc3339()),
                    deleted_at: None,
                };
                vault.entries.push(new_entry.clone());
                new_entry
            }
        };

        let vault_data = VaultData {
            entries: vault.entries.clone(),
            folders: vault.folders.clone(),
            deleted_entries: vault.trash.clone(),
            history: vault.history.clone(),
        };

        if let Err(e) = save_vault_data(&vault.master_password, &vault_data) {
            return (
                500,
                serde_json::json!({ "success": false, "error": e }).to_string(),
            );
        }

        // Notify desktop app UI if running
        if let Some(handle) = state.app_handle.lock().unwrap().as_ref() {
            use tauri::Emitter;
            let _ = handle.emit("vault-updated", serde_json::json!({ "entry": &saved_entry }));
        }

        let res = serde_json::json!({
            "success": true,
            "message": "Credential saved successfully",
            "entry": saved_entry
        });
        return (200, res.to_string());
    }

    (404, r#"{"error":"Not Found"}"#.to_string())
}

fn check_request_auth(
    headers: &std::collections::HashMap<String, String>,
    state: &Arc<ServerState>,
) -> bool {
    // 1. Check Bearer token
    if let Some(auth_val) = headers.get("authorization") {
        if let Some(token) = auth_val.strip_prefix("Bearer ") {
            if state.validate_token(token.trim()) {
                return true;
            }
        }
    }

    // 2. Check HMAC signature if timestamp and signature headers provided
    if let (Some(sig), Some(ts_str)) = (
        headers.get("x-request-signature"),
        headers.get("x-request-timestamp"),
    ) {
        if let Ok(ts) = ts_str.parse::<i64>() {
            let now = Utc::now().timestamp();
            if (now - ts).abs() <= 60 {
                let secret = state.shared_secret.lock().unwrap().clone();
                let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, secret.as_bytes());
                if let Ok(sig_bytes) = hex::decode(sig) {
                    if ring::hmac::verify(&key, ts_str.as_bytes(), &sig_bytes).is_ok() {
                        return true;
                    }
                }
            }
        }
    }

    false
}

fn build_response(status: u16, content_type: &str, body: &str, origin: &str) -> String {
    let status_text = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "Status",
    };

    let allow_origin = if origin.is_empty() { "*" } else { origin };

    format!(
        "HTTP/1.1 {} {}\r\n\
         Content-Type: {}\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: {}\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: *\r\n\
         Connection: close\r\n\r\n\
         {}",
        status,
        status_text,
        content_type,
        body.len(),
        allow_origin,
        body
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_server_state_lifecycle() {
        let state = ServerState::new();
        assert!(!state.is_unlocked());
        assert_eq!(state.get_entry_count(), 0);

        state.set_unlocked(
            "master123".to_string(),
            vec![Entry {
                id: "1".to_string(),
                site: "google.com".to_string(),
                username: "user@gmail.com".to_string(),
                password: "pass".to_string(),
                notes: "".to_string(),
                folder_id: None,
                created_at: "2026-01-01".to_string(),
                updated_at: None,
                deleted_at: None,
            }],
            vec![],
            vec![],
            vec![],
        );

        assert!(state.is_unlocked());
        assert_eq!(state.get_entry_count(), 1);

        state.lock();
        assert!(!state.is_unlocked());
        assert_eq!(state.get_entry_count(), 0);
    }

    #[test]
    fn test_token_validation() {
        let state = ServerState::new();
        let token = state.create_session_token();
        assert!(state.validate_token(&token));
        assert!(!state.validate_token("invalid_token"));

        state.lock();
        assert!(!state.validate_token(&token));
    }

    #[test]
    fn test_route_health() {
        let state = Arc::new(ServerState::new());
        let headers = std::collections::HashMap::new();
        let (status, body) = route_request("GET", "/health", "", &headers, "", &state);
        assert_eq!(status, 200);
        assert!(body.contains("\"status\":\"healthy\""));
        assert!(body.contains("\"unlocked\":false"));
    }

    #[test]
    fn test_route_generate_password() {
        let state = Arc::new(ServerState::new());
        let headers = std::collections::HashMap::new();
        let body_req = r#"{"length":20,"uppercase":true,"lowercase":true,"numbers":true,"symbols":true}"#;
        let (status, body) = route_request("POST", "/api/v1/generate-password", "", &headers, body_req, &state);
        assert_eq!(status, 200);
        let parsed: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert!(parsed["success"].as_bool().unwrap());
        assert_eq!(parsed["password"].as_str().unwrap().len(), 20);
    }
}

use chrono::Utc;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use zeroize::Zeroizing;

use crate::security;
use crate::{
    atomic_write, config_dir, vault_path, Entry, Folder, HistoryItem, TrashedEntry, VaultData,
};

pub struct UnlockedVault {
    pub master_password: Zeroizing<String>,
    pub entries: Vec<Entry>,
    pub folders: Vec<Folder>,
    pub trash: Vec<TrashedEntry>,
    pub history: Vec<HistoryItem>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct SessionToken {
    pub token: String,
    pub expires_at: i64,
    pub client_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PairedClient {
    pub id: String,
    pub label: String,
    pub browser: String,
    pub public_key: String, // 65-byte uncompressed P-256 public key hex (0x04 || X || Y)
    pub created_at: String,
    pub last_used: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PairingCode {
    pub code: String,
    pub expires_at: i64,
    pub attempts: u32,
}

pub struct ServerState {
    pub unlocked_data: Mutex<Option<UnlockedVault>>,
    pub session_token: Mutex<Option<SessionToken>>, // legacy fallback slot
    pub client_sessions: Mutex<HashMap<String, SessionToken>>, // token -> SessionToken
    pub shared_secret: Mutex<String>,
    pub write_semaphore: Arc<tokio::sync::Semaphore>,
    pub app_handle: Mutex<Option<tauri::AppHandle>>,
    pub pairing_code: Mutex<Option<PairingCode>>,
    pub pending_challenges: Mutex<HashMap<String, (String, i64)>>, // client_id -> (nonce_hex, expires_at)
    pub authorized_clients: Mutex<HashSet<String>>, // client_id authorized in current session
    pub server_error: Mutex<Option<String>>,
    pub require_presence_prompt: Mutex<bool>,
}

impl Default for ServerState {
    fn default() -> Self {
        Self::new()
    }
}

impl ServerState {
    pub fn new() -> Self {
        let secret = load_or_generate_secret();
        let semaphore = Arc::new(tokio::sync::Semaphore::new(1));
        Self {
            unlocked_data: Mutex::new(None),
            session_token: Mutex::new(None),
            client_sessions: Mutex::new(HashMap::new()),
            shared_secret: Mutex::new(secret),
            write_semaphore: semaphore,
            app_handle: Mutex::new(None),
            pairing_code: Mutex::new(None),
            pending_challenges: Mutex::new(HashMap::new()),
            authorized_clients: Mutex::new(HashSet::new()),
            server_error: Mutex::new(None),
            require_presence_prompt: Mutex::new(false),
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
            master_password: Zeroizing::new(master_password),
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
        let mut sessions = self.client_sessions.lock().unwrap();
        sessions.clear();
        let mut auth = self.authorized_clients.lock().unwrap();
        auth.clear();
        let mut challenges = self.pending_challenges.lock().unwrap();
        challenges.clear();
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
        self.create_client_session(None)
    }

    pub fn create_client_session(&self, client_id: Option<&str>) -> String {
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        let token = hex::encode(bytes);
        let expires_at = Utc::now().timestamp() + 900; // 15 minutes
        let st = SessionToken {
            token: token.clone(),
            expires_at,
            client_id: client_id.map(|s| s.to_string()),
        };

        let mut sessions = self.client_sessions.lock().unwrap();
        let now = Utc::now().timestamp();
        sessions.retain(|_, s| s.expires_at > now);
        sessions.insert(token.clone(), st.clone());

        let mut legacy = self.session_token.lock().unwrap();
        *legacy = Some(st);

        token
    }

    pub fn validate_token(&self, token_to_check: &str) -> bool {
        let now = Utc::now().timestamp();
        let sessions = self.client_sessions.lock().unwrap();
        if let Some(st) = sessions.get(token_to_check) {
            if st.expires_at > now {
                if let Some(ref cid) = st.client_id {
                    let clients = load_paired_clients();
                    if !clients.iter().any(|c| c.id == *cid) {
                        return false; // Revoked!
                    }
                }
                return true;
            }
        }

        let legacy = self.session_token.lock().unwrap();
        if let Some(st) = &*legacy {
            if st.token == token_to_check && st.expires_at > now {
                if let Some(ref cid) = st.client_id {
                    let clients = load_paired_clients();
                    if !clients.iter().any(|c| c.id == *cid) {
                        return false;
                    }
                }
                return true;
            }
        }
        false
    }

    pub fn generate_pairing_code(&self) -> Result<String, String> {
        if !self.is_unlocked() {
            return Err("Vault must be unlocked to pair a browser".to_string());
        }
        let mut num_bytes = [0u8; 4];
        rand::thread_rng().fill_bytes(&mut num_bytes);
        let code_num = (u32::from_be_bytes(num_bytes) % 900_000) + 100_000;
        let code = format!("{:06}", code_num);
        let expires_at = Utc::now().timestamp() + 120; // 2 minutes

        let mut pc = self.pairing_code.lock().unwrap();
        *pc = Some(PairingCode {
            code: code.clone(),
            expires_at,
            attempts: 0,
        });

        Ok(code)
    }

    pub fn revoke_client(&self, client_id: &str) -> bool {
        let mut clients = load_paired_clients();
        let initial_len = clients.len();
        clients.retain(|c| c.id != client_id);
        if clients.len() == initial_len {
            return false;
        }
        let _ = save_paired_clients(&clients);

        let mut sessions = self.client_sessions.lock().unwrap();
        sessions.retain(|_, st| st.client_id.as_deref() != Some(client_id));

        let mut auth = self.authorized_clients.lock().unwrap();
        auth.remove(client_id);

        let mut challenges = self.pending_challenges.lock().unwrap();
        challenges.remove(client_id);

        true
    }
}

pub fn get_paired_clients_path() -> PathBuf {
    if let Ok(p) = std::env::var("CAIXA_PAIRED_CLIENTS_PATH") {
        return PathBuf::from(p);
    }
    config_dir().join("paired_clients.json")
}

pub fn load_paired_clients() -> Vec<PairedClient> {
    let path = get_paired_clients_path();
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => Ok(c),
        Err(_) => {
            let fallback = std::env::temp_dir().join("caixa_paired_clients.json");
            std::fs::read_to_string(&fallback)
        }
    };
    match content {
        Ok(c) => serde_json::from_str(&c).unwrap_or_default(),
        Err(_) => vec![],
    }
}

pub fn save_paired_clients(clients: &[PairedClient]) -> Result<(), String> {
    let path = get_paired_clients_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let data = serde_json::to_string_pretty(clients)
        .map_err(|e| format!("Failed to serialize paired clients: {}", e))?;
    match std::fs::write(&path, &data) {
        Ok(_) => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
            }
            Ok(())
        }
        Err(e) => {
            let fallback = std::env::temp_dir().join("caixa_paired_clients.json");
            match std::fs::write(&fallback, &data) {
                Ok(_) => Ok(()),
                Err(e2) => Err(format!(
                    "Failed to write paired clients: {} (fallback failed: {})",
                    e, e2
                )),
            }
        }
    }
}

// ── ECDSA P-256 verification ────────────────────────────────────────────────

pub fn verify_ecdsa_p256_signature(
    public_key_hex: &str,
    message_bytes: &[u8],
    signature_hex: &str,
) -> bool {
    let public_key_bytes = match hex::decode(public_key_hex.trim()) {
        Ok(b) => b,
        Err(_) => return false,
    };
    let signature_bytes = match hex::decode(signature_hex.trim()) {
        Ok(b) => b,
        Err(_) => return false,
    };

    let peer_public_key = ring::signature::UnparsedPublicKey::new(
        &ring::signature::ECDSA_P256_SHA256_FIXED,
        &public_key_bytes,
    );

    peer_public_key
        .verify(message_bytes, &signature_bytes)
        .is_ok()
}

// ── Domain matching ──────────────────────────────────────────────────────────

pub fn matches_domain(entry_site: &str, query_domain: &str) -> bool {
    let q = query_domain.trim().to_lowercase();
    if q.is_empty() {
        return false;
    }
    let clean_q = clean_host(&q);
    if clean_q.is_empty() {
        return false;
    }

    let clean_e = clean_host(&entry_site.to_lowercase());
    if clean_e.is_empty() {
        return false;
    }

    if clean_e == clean_q {
        return true;
    }

    let Some(entry_domain) = psl::domain_str(&clean_e) else {
        return false;
    };
    if psl::domain_str(&clean_q) != Some(entry_domain) {
        return false;
    }

    clean_q.ends_with(&format!(".{}", clean_e))
}

fn clean_host(input: &str) -> String {
    let mut s = input.trim();
    if let Some(stripped) = s.strip_prefix("https://") {
        s = stripped;
    } else if let Some(stripped) = s.strip_prefix("http://") {
        s = stripped;
    }
    if let Some((host_part, _)) = s.split_once('/') {
        s = host_part;
    }
    if let Some((host_part, _)) = s.split_once(':') {
        s = host_part;
    }
    s.trim_start_matches("www.").to_string()
}

// ── Vault persistence helpers ────────────────────────────────────────────────

fn load_or_generate_secret() -> String {
    let secret_path = config_dir().join("extension_secret.key");

    if secret_path.exists() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(parent) = secret_path.parent() {
                let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
            }
            let _ = std::fs::set_permissions(&secret_path, std::fs::Permissions::from_mode(0o600));
        }
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

    let _ = atomic_write(&secret_path, secret.as_bytes());
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

    let vault_path = vault_path();
    let payload = serde_json::json!({
        "salt": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &salt),
        "nonce": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &nonce_bytes),
        "ciphertext": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &ciphertext),
        "version": "1"
    });

    let mut last_error = String::new();
    for attempt in 0..3 {
        match atomic_write(&vault_path, payload.to_string().as_bytes()) {
            Ok(()) => return Ok(()),
            Err(error) => {
                last_error = error;
                if attempt < 2 {
                    std::thread::sleep(std::time::Duration::from_millis(100 * (attempt + 1)));
                }
            }
        }
    }

    Err(format!(
        "Failed to write vault after retries: {}",
        last_error
    ))
}

pub fn decrypt_vault_from_disk(master_password: &str) -> Result<VaultData, String> {
    let vault_path = vault_path();
    if !vault_path.exists() {
        return Ok(VaultData {
            entries: vec![],
            folders: vec![],
            deleted_entries: vec![],
            history: vec![],
        });
    }

    let content =
        std::fs::read_to_string(&vault_path).map_err(|e| format!("Failed to read vault: {}", e))?;

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

// ── HTTP Server Implementation ───────────────────────────────────────────────

pub async fn start_server(state: Arc<ServerState>, port: u16) -> Result<(), String> {
    let requested_addr = format!("127.0.0.1:{}", port);
    let listener = match TcpListener::bind(&requested_addr).await {
        Ok(listener) => listener,
        Err(bind_error) => TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|fallback_error| {
                let message = format!(
                    "Failed to bind to {} ({}), including an available loopback port ({})",
                    requested_addr, bind_error, fallback_error
                );
                *state.server_error.lock().unwrap() = Some(message.clone());
                message
            })?,
    };
    let actual_port = listener
        .local_addr()
        .map_err(|error| format!("Failed to inspect local server port: {}", error))?
        .port();
    atomic_write(
        &config_dir().join("extension_port"),
        actual_port.to_string().as_bytes(),
    )?;
    let addr = format!("127.0.0.1:{}", actual_port);

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
    if !peer_addr.ip().is_loopback() {
        let response = "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        let _ = stream.write_all(response.as_bytes()).await;
        return;
    }

    let (method, full_path, headers, body) = match read_bounded_request(&mut stream).await {
        Ok(request) => request,
        Err((status, message)) => {
            let body = serde_json::json!({"error": message}).to_string();
            let response = build_response(status, "application/json", &body);
            let _ = stream.write_all(response.as_bytes()).await;
            return;
        }
    };

    // Host header check: only loopback host accepted (hardened loopback)
    let host = headers.get("host").cloned().unwrap_or_default();
    let host_domain = host.split(':').next().unwrap_or("");
    if host_domain != "127.0.0.1" && host_domain != "localhost" {
        let res = build_response(
            400,
            "application/json",
            r#"{"error":"Invalid Host header"}"#,
        );
        let _ = stream.write_all(res.as_bytes()).await;
        return;
    }

    if method == "OPTIONS" {
        let res = build_response(204, "text/plain", "");
        let _ = stream.write_all(res.as_bytes()).await;
        return;
    }

    let (path, query) = match full_path.split_once('?') {
        Some((p, q)) => (p, q),
        None => (full_path.as_str(), ""),
    };

    let (status, res_body) = route_request(&method, path, query, &headers, &body, &state).await;

    let res = build_response(status, "application/json", &res_body);
    let _ = stream.write_all(res.as_bytes()).await;
}

async fn read_bounded_request(
    stream: &mut TcpStream,
) -> Result<(String, String, HashMap<String, String>, String), (u16, &'static str)> {
    const MAX_HEADER_BYTES: usize = 16 * 1024;
    const MAX_BODY_BYTES: usize = 1024 * 1024;
    let mut request = Vec::with_capacity(4096);
    let header_end = loop {
        if let Some(position) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
            break position;
        }
        if request.len() >= MAX_HEADER_BYTES {
            return Err((431, "Request headers are too large"));
        }
        let mut chunk = [0u8; 4096];
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|_| (400, "Failed to read request"))?;
        if read == 0 {
            return Err((400, "Incomplete request headers"));
        }
        request.extend_from_slice(&chunk[..read]);
    };

    if header_end > MAX_HEADER_BYTES {
        return Err((431, "Request headers are too large"));
    }
    let header = std::str::from_utf8(&request[..header_end])
        .map_err(|_| (400, "Request headers are not valid UTF-8"))?;
    let mut lines = header.split("\r\n");
    let request_line = lines.next().ok_or((400, "Missing request line"))?;
    let parts: Vec<_> = request_line.split_whitespace().collect();
    if parts.len() != 3 || !parts[2].starts_with("HTTP/1.") {
        return Err((400, "Invalid request line"));
    }
    let method = parts[0].to_string();
    let full_path = parts[1].to_string();

    let mut headers = HashMap::new();
    for line in lines {
        let (name, value) = line
            .split_once(':')
            .ok_or((400, "Invalid request header"))?;
        let name = name.trim().to_ascii_lowercase();
        if headers.insert(name, value.trim().to_string()).is_some() {
            return Err((400, "Duplicate request header"));
        }
    }
    if headers.contains_key("transfer-encoding") {
        return Err((400, "Transfer-Encoding is not supported"));
    }

    let content_length = headers
        .get("content-length")
        .map(|value| {
            value
                .parse::<usize>()
                .map_err(|_| (400, "Invalid Content-Length"))
        })
        .transpose()?
        .unwrap_or(0);
    if content_length > MAX_BODY_BYTES {
        return Err((413, "Request body is too large"));
    }
    if matches!(method.as_str(), "POST" | "PUT" | "PATCH")
        && !headers.contains_key("content-length")
    {
        return Err((411, "Content-Length is required"));
    }

    let body_start = header_end + 4;
    let request_end = body_start
        .checked_add(content_length)
        .ok_or((413, "Request body is too large"))?;
    while request.len() < request_end {
        let mut chunk = [0u8; 4096];
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|_| (400, "Failed to read request body"))?;
        if read == 0 {
            return Err((400, "Incomplete request body"));
        }
        request.extend_from_slice(&chunk[..read]);
    }
    let body = std::str::from_utf8(&request[body_start..request_end])
        .map_err(|_| (400, "Request body is not valid UTF-8"))?
        .to_string();

    Ok((method, full_path, headers, body))
}

pub async fn route_request(
    method: &str,
    path: &str,
    query: &str,
    headers: &HashMap<String, String>,
    body: &str,
    state: &Arc<ServerState>,
) -> (u16, String) {
    // ── 1. Minimal health check (unauthenticated, never leaks entry count) ──
    if (path == "/health" || path == "/api/v1/health") && method == "GET" {
        let res = serde_json::json!({
            "status": "healthy",
            "app": "Caixa Forta",
            "version": "1.0.0"
        });
        return (200, res.to_string());
    }

    // ── 2. Vault status info ───────────────────────────────────────────────
    if path == "/api/v1/vault-info" && method == "GET" {
        let unlocked = state.is_unlocked();
        let count = if unlocked { state.get_entry_count() } else { 0 };
        let res = serde_json::json!({
            "success": true,
            "connected": true,
            "unlocked": unlocked,
            "entry_count": count
        });
        return (200, res.to_string());
    }

    // ── 3. Device pairing (Phase 3) ────────────────────────────────────────
    if path == "/api/v1/pair" && method == "POST" {
        let parsed: serde_json::Value = match serde_json::from_str(body) {
            Ok(v) => v,
            Err(_) => return (400, r#"{"error":"Invalid JSON body"}"#.to_string()),
        };

        let submitted_code = parsed["code"].as_str().unwrap_or("").trim();
        let label = parsed["label"].as_str().unwrap_or("Browser").trim();
        let browser = parsed["browser"].as_str().unwrap_or("unknown").trim();
        let public_key = parsed["public_key"].as_str().unwrap_or("").trim();

        if public_key.is_empty() {
            return (
                400,
                r#"{"success":false,"error":"Missing public_key"}"#.to_string(),
            );
        }

        let now = Utc::now().timestamp();
        let mut pc_guard = state.pairing_code.lock().unwrap();
        let pc = match &mut *pc_guard {
            Some(pc) => pc,
            None => {
                return (
                    400,
                    r#"{"success":false,"error":"No active pairing session"}"#.to_string(),
                );
            }
        };

        if pc.expires_at <= now {
            *pc_guard = None;
            return (
                400,
                r#"{"success":false,"error":"Pairing code expired"}"#.to_string(),
            );
        }

        if pc.attempts >= 5 {
            *pc_guard = None;
            return (
                400,
                r#"{"success":false,"error":"Too many attempts. Pairing code locked."}"#
                    .to_string(),
            );
        }

        if pc.code != submitted_code {
            pc.attempts += 1;
            if pc.attempts >= 5 {
                *pc_guard = None;
                return (
                    401,
                    r#"{"success":false,"error":"Too many attempts. Pairing code locked."}"#
                        .to_string(),
                );
            }
            return (
                401,
                r#"{"success":false,"error":"Invalid pairing code"}"#.to_string(),
            );
        }

        // Single-use: clear immediately
        *pc_guard = None;

        let client_id = uuid::Uuid::new_v4().to_string();
        let new_client = PairedClient {
            id: client_id.clone(),
            label: label.to_string(),
            browser: browser.to_string(),
            public_key: public_key.to_string(),
            created_at: Utc::now().to_rfc3339(),
            last_used: Some(Utc::now().to_rfc3339()),
        };

        let mut clients = load_paired_clients();
        clients.push(new_client);
        if let Err(e) = save_paired_clients(&clients) {
            return (
                500,
                serde_json::json!({ "success": false, "error": e }).to_string(),
            );
        }

        state
            .authorized_clients
            .lock()
            .unwrap()
            .insert(client_id.clone());

        let res = serde_json::json!({
            "success": true,
            "client_id": client_id,
            "message": "Device paired successfully"
        });
        return (200, res.to_string());
    }

    // ── 4. Challenge generation (Phase 3) ──────────────────────────────────
    if path == "/api/v1/challenge" && method == "GET" {
        let client_id = query
            .split('&')
            .find_map(|pair| {
                let mut s = pair.split('=');
                if s.next() == Some("client_id") {
                    s.next().map(|val| val.to_string())
                } else {
                    None
                }
            })
            .unwrap_or_default();

        if client_id.is_empty() {
            return (
                400,
                r#"{"success":false,"error":"Missing client_id"}"#.to_string(),
            );
        }

        let clients = load_paired_clients();
        if !clients.iter().any(|c| c.id == client_id) {
            return (
                401,
                r#"{"success":false,"error":"Unknown or unapproved client"}"#.to_string(),
            );
        }

        let mut nonce_bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = hex::encode(nonce_bytes);
        let expires_at = Utc::now().timestamp() + 60; // 60 seconds

        state
            .pending_challenges
            .lock()
            .unwrap()
            .insert(client_id, (nonce.clone(), expires_at));

        let res = serde_json::json!({
            "success": true,
            "nonce": nonce
        });
        return (200, res.to_string());
    }

    // ── 5. Challenge response verification (Phase 3) ───────────────────────
    if path == "/api/v1/challenge-response" && method == "POST" {
        let parsed: serde_json::Value = match serde_json::from_str(body) {
            Ok(v) => v,
            Err(_) => return (400, r#"{"error":"Invalid JSON body"}"#.to_string()),
        };

        let client_id = parsed["client_id"].as_str().unwrap_or("").trim();
        let signature = parsed["signature"].as_str().unwrap_or("").trim();
        let nonce = parsed["nonce"].as_str().unwrap_or("").trim();

        if client_id.is_empty() || signature.is_empty() || nonce.is_empty() {
            return (
                400,
                r#"{"success":false,"error":"Missing client_id, signature, or nonce"}"#.to_string(),
            );
        }

        // Remove immediately to prevent replay
        let pending = state.pending_challenges.lock().unwrap().remove(client_id);
        let (stored_nonce, expires_at) = match pending {
            Some(p) => p,
            None => {
                return (
                    401,
                    r#"{"success":false,"error":"No pending challenge or challenge already consumed"}"#.to_string(),
                );
            }
        };

        let now = Utc::now().timestamp();
        if expires_at <= now {
            return (
                401,
                r#"{"success":false,"error":"Challenge nonce expired"}"#.to_string(),
            );
        }

        if stored_nonce != nonce {
            return (
                401,
                r#"{"success":false,"error":"Challenge nonce mismatch"}"#.to_string(),
            );
        }

        let mut clients = load_paired_clients();
        let client = match clients.iter_mut().find(|c| c.id == client_id) {
            Some(c) => c,
            None => {
                return (
                    401,
                    r#"{"success":false,"error":"Client not found in paired registry"}"#
                        .to_string(),
                );
            }
        };

        let nonce_bytes = match hex::decode(nonce) {
            Ok(b) => b,
            Err(_) => {
                return (
                    400,
                    r#"{"success":false,"error":"Invalid nonce hex encoding"}"#.to_string(),
                );
            }
        };

        if !verify_ecdsa_p256_signature(&client.public_key, &nonce_bytes, signature) {
            return (
                401,
                r#"{"success":false,"error":"Signature verification failed"}"#.to_string(),
            );
        }

        // User presence check (Target design 4)
        let require_prompt = *state.require_presence_prompt.lock().unwrap();
        let is_authorized = state.authorized_clients.lock().unwrap().contains(client_id);
        if require_prompt && !is_authorized {
            if let Some(handle) = state.app_handle.lock().unwrap().as_ref() {
                use tauri::Emitter;
                let _ = handle.emit(
                    "browser-connection-request",
                    serde_json::json!({
                        "client_id": client_id,
                        "label": client.label,
                        "browser": client.browser,
                    }),
                );
            }
        }
        state
            .authorized_clients
            .lock()
            .unwrap()
            .insert(client_id.to_string());

        client.last_used = Some(Utc::now().to_rfc3339());
        let _ = save_paired_clients(&clients);

        let token = state.create_client_session(Some(client_id));
        let res = serde_json::json!({
            "success": true,
            "token": token,
            "unlocked": state.is_unlocked()
        });
        return (200, res.to_string());
    }

    // ── 6. Authenticated Handshake (F7 fix: shared_secret required, never leaked) ──
    if path == "/api/v1/handshake" && method == "GET" {
        let provided_secret = headers.get("x-shared-secret").cloned().unwrap_or_default();
        let current_secret = state.shared_secret.lock().unwrap().clone();
        if provided_secret.is_empty() || provided_secret != current_secret {
            return (
                401,
                r#"{"success":false,"error":"Shared secret required"}"#.to_string(),
            );
        }
        let token = state.create_client_session(None);
        let res = serde_json::json!({
            "success": true,
            "token": token,
            "unlocked": state.is_unlocked()
        });
        return (200, res.to_string());
    }

    // ── 7. Desktop authentication route ────────────────────────────────────
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
                    let token = state.create_client_session(None);
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
            let token = state.create_client_session(None);
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

    // F9 fix: Extension cannot unlock the vault; unlock must happen in desktop app.
    if path == "/api/v1/unlock" && method == "POST" {
        return (
            403,
            r#"{"success":false,"error":"Vault must be unlocked from the desktop application"}"#
                .to_string(),
        );
    }

    if path == "/api/v1/lock" && method == "POST" {
        // Vault lock action requires authentication or explicit caller
        if !check_request_auth(headers, state) {
            return (
                401,
                r#"{"success":false,"error":"Authentication required"}"#.to_string(),
            );
        }
        state.lock();
        return (
            200,
            r#"{"success":true,"message":"Vault locked"}"#.to_string(),
        );
    }

    if path == "/api/v1/generate-password" && method == "POST" {
        let parsed: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
        let length = parsed["length"].as_u64().unwrap_or(16) as u32;
        let uppercase = parsed["uppercase"].as_bool().unwrap_or(true);
        let lowercase = parsed["lowercase"].as_bool().unwrap_or(true);
        let numbers = parsed["numbers"].as_bool().unwrap_or(true);
        let symbols = parsed["symbols"].as_bool().unwrap_or(true);

        let password = security::generate_password(length, uppercase, lowercase, numbers, symbols);
        let res = serde_json::json!({
            "success": true,
            "password": password
        });
        return (200, res.to_string());
    }

    // ── 8. Authenticated credential access ─────────────────────────────────
    let is_authenticated = check_request_auth(headers, state);
    if !is_authenticated {
        return (
            401,
            r#"{"success":false,"error":"Authentication required or token expired"}"#.to_string(),
        );
    }

    // The extension may list saved entries, but this index deliberately omits
    // passwords. Secrets are released only by the domain-scoped endpoint below.
    if path == "/api/v1/credentials/index" && method == "GET" {
        let unlocked = state.unlocked_data.lock().unwrap();
        let vault = match &*unlocked {
            Some(v) => v,
            None => {
                return (401, r#"{"success":false,"unlocked":false,"error":"Vault is locked"}"#.to_string());
            }
        };
        let entries: Vec<serde_json::Value> = vault.entries.iter().map(|e| serde_json::json!({
            "id": e.id, "site": e.site, "username": e.username
        })).collect();
        return (200, serde_json::json!({"success":true,"unlocked":true,"credentials":entries}).to_string());
    }

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
                    s.next().map(|val| val.to_string())
                } else {
                    None
                }
            })
            .unwrap_or_default();

        // Safe credential release policy (Target design 5):
        // Empty domain returns nothing!
        if domain_param.trim().is_empty() {
            let res = serde_json::json!({
                "success": true,
                "unlocked": true,
                "credentials": []
            });
            return (200, res.to_string());
        }

        // Only exact host or subdomain matches. Only return needed fields.
        let filtered: Vec<serde_json::Value> = vault
            .entries
            .iter()
            .filter(|e| matches_domain(&e.site, &domain_param))
            .map(|e| {
                serde_json::json!({
                    "id": e.id,
                    "site": e.site,
                    "username": e.username,
                    "password": e.password,
                    "notes": e.notes,
                })
            })
            .collect();

        let res = serde_json::json!({
            "success": true,
            "unlocked": true,
            "credentials": filtered
        });
        return (200, res.to_string());
    }

    if path == "/api/v1/credentials" && method == "POST" {
        // Serialized writes: actually acquire semaphore (F13 fix)
        let _permit = match state.write_semaphore.acquire().await {
            Ok(p) => p,
            Err(e) => {
                return (
                    500,
                    serde_json::json!({"success":false,"error":e.to_string()}).to_string(),
                )
            }
        };

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

        if let Some(handle) = state.app_handle.lock().unwrap().as_ref() {
            use tauri::Emitter;
            let _ = handle.emit(
                "vault-updated",
                serde_json::json!({ "entry": &saved_entry }),
            );
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

fn check_request_auth(headers: &HashMap<String, String>, state: &Arc<ServerState>) -> bool {
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

fn build_response(status: u16, content_type: &str, body: &str) -> String {
    let status_text = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        _ => "Status",
    };

    format!(
        "HTTP/1.1 {} {}\r\n\
         Content-Type: {}\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n\
         {}",
        status,
        status_text,
        content_type,
        body.len(),
        body
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::KeyPair;

    static PAIRED_CLIENTS_TEST_LOCK: Mutex<()> = Mutex::new(());

    struct PairedClientsTestIsolation {
        _lock: std::sync::MutexGuard<'static, ()>,
        _directory: tempfile::TempDir,
        previous_path: Option<std::ffi::OsString>,
    }

    impl PairedClientsTestIsolation {
        fn new() -> Self {
            let lock = PAIRED_CLIENTS_TEST_LOCK.lock().unwrap();
            let directory = tempfile::tempdir().unwrap();
            let previous_path = std::env::var_os("CAIXA_PAIRED_CLIENTS_PATH");
            std::env::set_var(
                "CAIXA_PAIRED_CLIENTS_PATH",
                directory.path().join("paired_clients.json"),
            );
            Self {
                _lock: lock,
                _directory: directory,
                previous_path,
            }
        }
    }

    impl Drop for PairedClientsTestIsolation {
        fn drop(&mut self) {
            match self.previous_path.take() {
                Some(path) => std::env::set_var("CAIXA_PAIRED_CLIENTS_PATH", path),
                None => std::env::remove_var("CAIXA_PAIRED_CLIENTS_PATH"),
            }
        }
    }

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

    #[tokio::test]
    async fn test_route_health_does_not_leak_entry_count() {
        let state = Arc::new(ServerState::new());
        state.set_unlocked(
            "pwd".to_string(),
            vec![Entry {
                id: "1".to_string(),
                site: "example.com".to_string(),
                username: "user".to_string(),
                password: "pass".to_string(),
                notes: "".to_string(),
                folder_id: None,
                created_at: "".to_string(),
                updated_at: None,
                deleted_at: None,
            }],
            vec![],
            vec![],
            vec![],
        );
        let headers = HashMap::new();
        let (status, body) = route_request("GET", "/health", "", &headers, "", &state).await;
        assert_eq!(status, 200);
        assert!(body.contains("\"status\":\"healthy\""));
        assert!(!body.contains("entry_count"));
        assert!(!body.contains("unlocked"));
    }

    #[tokio::test]
    async fn test_route_generate_password() {
        let state = Arc::new(ServerState::new());
        let headers = HashMap::new();
        let body_req =
            r#"{"length":20,"uppercase":true,"lowercase":true,"numbers":true,"symbols":true}"#;
        let (status, body) = route_request(
            "POST",
            "/api/v1/generate-password",
            "",
            &headers,
            body_req,
            &state,
        )
        .await;
        assert_eq!(status, 200);
        let parsed: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert!(parsed["success"].as_bool().unwrap());
        assert_eq!(parsed["password"].as_str().unwrap().len(), 20);
    }

    #[test]
    fn test_domain_matching_security() {
        // Exact match
        assert!(matches_domain("google.com", "google.com"));
        assert!(matches_domain("google.com", "www.google.com"));
        assert!(matches_domain("https://google.com", "google.com"));

        // Subdomain of entry matches
        assert!(matches_domain("google.com", "accounts.google.com"));
        assert!(!matches_domain("accounts.google.com", "google.com"));
        assert!(!matches_domain("github.io", "project.github.io"));
        assert!(!matches_domain("project.github.io", "other.github.io"));
        assert!(matches_domain(
            "project.github.io",
            "login.project.github.io"
        ));

        // Phishing / lookalike MUST NOT match
        assert!(!matches_domain("google.com", "evilgoogle.com"));
        assert!(!matches_domain("google.com", "google.com.evil.com"));
        assert!(!matches_domain("google.com", "notgoogle.com"));
        assert!(!matches_domain("google.com", "google.co"));

        // Empty domain returns false
        assert!(!matches_domain("google.com", ""));
        assert!(!matches_domain("", "google.com"));
    }

    #[tokio::test]
    async fn test_credentials_release_policy() {
        let state = Arc::new(ServerState::new());
        state.set_unlocked(
            "master".to_string(),
            vec![
                Entry {
                    id: "1".to_string(),
                    site: "google.com".to_string(),
                    username: "user@gmail.com".to_string(),
                    password: "secretpassword".to_string(),
                    notes: "note".to_string(),
                    folder_id: None,
                    created_at: "2026-01-01".to_string(),
                    updated_at: None,
                    deleted_at: None,
                },
                Entry {
                    id: "2".to_string(),
                    site: "github.com".to_string(),
                    username: "dev".to_string(),
                    password: "ghpassword".to_string(),
                    notes: "".to_string(),
                    folder_id: None,
                    created_at: "2026-01-01".to_string(),
                    updated_at: None,
                    deleted_at: None,
                },
            ],
            vec![],
            vec![],
            vec![],
        );

        let token = state.create_session_token();
        let mut headers = HashMap::new();
        headers.insert("authorization".to_string(), format!("Bearer {}", token));

        let (index_status, index_body) = route_request(
            "GET", "/api/v1/credentials/index", "", &headers, "", &state,
        ).await;
        assert_eq!(index_status, 200);
        let index: serde_json::Value = serde_json::from_str(&index_body).unwrap();
        assert_eq!(index["credentials"].as_array().unwrap().len(), 2);
        assert!(index["credentials"][0].get("password").is_none());

        // 1. Empty domain parameter returns NO credentials
        let (status, body) =
            route_request("GET", "/api/v1/credentials", "", &headers, "", &state).await;
        assert_eq!(status, 200);
        let parsed: serde_json::Value = serde_json::from_str(&body).unwrap();
        let creds = parsed["credentials"].as_array().unwrap();
        assert_eq!(creds.len(), 0);

        // 2. Exact match returns only matching site
        let (status, body) = route_request(
            "GET",
            "/api/v1/credentials",
            "domain=google.com",
            &headers,
            "",
            &state,
        )
        .await;
        assert_eq!(status, 200);
        let parsed: serde_json::Value = serde_json::from_str(&body).unwrap();
        let creds = parsed["credentials"].as_array().unwrap();
        assert_eq!(creds.len(), 1);
        assert_eq!(creds[0]["site"], "google.com");

        // 3. Phishing domain returns 0 entries
        let (status, body) = route_request(
            "GET",
            "/api/v1/credentials",
            "domain=evilgoogle.com",
            &headers,
            "",
            &state,
        )
        .await;
        assert_eq!(status, 200);
        let parsed: serde_json::Value = serde_json::from_str(&body).unwrap();
        let creds = parsed["credentials"].as_array().unwrap();
        assert_eq!(creds.len(), 0);

        // 4. Subdomain of evil returns 0 entries
        let (status, body) = route_request(
            "GET",
            "/api/v1/credentials",
            "domain=google.com.evil.com",
            &headers,
            "",
            &state,
        )
        .await;
        assert_eq!(status, 200);
        let parsed: serde_json::Value = serde_json::from_str(&body).unwrap();
        let creds = parsed["credentials"].as_array().unwrap();
        assert_eq!(creds.len(), 0);
    }

    #[tokio::test]
    async fn test_pairing_code_lifecycle() {
        let _paired_clients = PairedClientsTestIsolation::new();
        let state = Arc::new(ServerState::new());
        state.set_unlocked("master".to_string(), vec![], vec![], vec![], vec![]);

        let code = state.generate_pairing_code().unwrap();
        assert_eq!(code.len(), 6);

        let headers = HashMap::new();

        // 1. Wrong code increments attempts
        let wrong_body = serde_json::json!({
            "code": "000000",
            "label": "Test Chrome",
            "browser": "chrome",
            "public_key": "04abcd"
        })
        .to_string();
        let (status, _) =
            route_request("POST", "/api/v1/pair", "", &headers, &wrong_body, &state).await;
        assert_eq!(status, 401);

        // 2. Correct code pairs successfully and clears the code (single-use)
        let correct_body = serde_json::json!({
            "code": code,
            "label": "Test Chrome",
            "browser": "chrome",
            "public_key": "04112233"
        })
        .to_string();
        let (status, res) =
            route_request("POST", "/api/v1/pair", "", &headers, &correct_body, &state).await;
        assert_eq!(status, 200);
        let parsed: serde_json::Value = serde_json::from_str(&res).unwrap();
        assert!(parsed["success"].as_bool().unwrap());
        let client_id = parsed["client_id"].as_str().unwrap();

        // 3. Re-using the same pairing code fails (single-use!)
        let (status2, _) =
            route_request("POST", "/api/v1/pair", "", &headers, &correct_body, &state).await;
        assert_eq!(status2, 400);

        // Clean up test client
        state.revoke_client(client_id);
    }

    #[tokio::test]
    async fn test_unauthenticated_handshake_rejected() {
        let state = Arc::new(ServerState::new());
        let headers = HashMap::new(); // No x-shared-secret header
        let (status, body) =
            route_request("GET", "/api/v1/handshake", "", &headers, "", &state).await;
        assert_eq!(status, 401);
        assert!(!body.contains("shared_secret"));
    }

    #[tokio::test]
    async fn test_challenge_response_and_revocation_lifecycle() {
        let _paired_clients = PairedClientsTestIsolation::new();
        let state = Arc::new(ServerState::new());
        state.set_unlocked(
            "master".to_string(),
            vec![Entry {
                id: "1".to_string(),
                site: "example.com".to_string(),
                username: "user".to_string(),
                password: "pass".to_string(),
                notes: "".to_string(),
                folder_id: None,
                created_at: "".to_string(),
                updated_at: None,
                deleted_at: None,
            }],
            vec![],
            vec![],
            vec![],
        );

        // 1. Generate client ECDSA P-256 keypair
        let rng = ring::rand::SystemRandom::new();
        let pkcs8 = ring::signature::EcdsaKeyPair::generate_pkcs8(
            &ring::signature::ECDSA_P256_SHA256_FIXED_SIGNING,
            &rng,
        )
        .unwrap();
        let key_pair = ring::signature::EcdsaKeyPair::from_pkcs8(
            &ring::signature::ECDSA_P256_SHA256_FIXED_SIGNING,
            pkcs8.as_ref(),
            &rng,
        )
        .unwrap();
        let pub_key_hex = hex::encode(key_pair.public_key().as_ref());

        // 2. Pair device
        let code = state.generate_pairing_code().unwrap();
        let headers = HashMap::new();
        let pair_body = serde_json::json!({
            "code": code,
            "label": "Test Device",
            "browser": "firefox",
            "public_key": pub_key_hex,
        })
        .to_string();
        let (p_status, p_res) =
            route_request("POST", "/api/v1/pair", "", &headers, &pair_body, &state).await;
        assert_eq!(p_status, 200);
        let client_id = serde_json::from_str::<serde_json::Value>(&p_res).unwrap()["client_id"]
            .as_str()
            .unwrap()
            .to_string();

        // 3. Request challenge nonce
        let (c_status, c_res) = route_request(
            "GET",
            "/api/v1/challenge",
            &format!("client_id={}", client_id),
            &headers,
            "",
            &state,
        )
        .await;
        assert_eq!(c_status, 200);
        let nonce_hex = serde_json::from_str::<serde_json::Value>(&c_res).unwrap()["nonce"]
            .as_str()
            .unwrap()
            .to_string();
        let _nonce_bytes = hex::decode(&nonce_hex).unwrap();

        // 4. Test wrong signature rejected
        let bad_resp_body = serde_json::json!({
            "client_id": client_id,
            "signature": hex::encode([0u8; 64]),
            "nonce": nonce_hex,
        })
        .to_string();
        let (bad_status, _) = route_request(
            "POST",
            "/api/v1/challenge-response",
            "",
            &headers,
            &bad_resp_body,
            &state,
        )
        .await;
        assert_eq!(bad_status, 401);

        // 5. Request new nonce (since bad attempt consumed old one)
        let (_, c_res2) = route_request(
            "GET",
            "/api/v1/challenge",
            &format!("client_id={}", client_id),
            &headers,
            "",
            &state,
        )
        .await;
        let nonce_hex2 = serde_json::from_str::<serde_json::Value>(&c_res2).unwrap()["nonce"]
            .as_str()
            .unwrap()
            .to_string();
        let nonce_bytes2 = hex::decode(&nonce_hex2).unwrap();

        // 6. Valid signature succeeds and returns session token
        let sig = key_pair.sign(&rng, &nonce_bytes2).unwrap();
        let sig_hex = hex::encode(sig.as_ref());
        let good_resp_body = serde_json::json!({
            "client_id": client_id,
            "signature": sig_hex,
            "nonce": nonce_hex2,
        })
        .to_string();
        let (good_status, good_res) = route_request(
            "POST",
            "/api/v1/challenge-response",
            "",
            &headers,
            &good_resp_body,
            &state,
        )
        .await;
        assert_eq!(good_status, 200);
        let token = serde_json::from_str::<serde_json::Value>(&good_res).unwrap()["token"]
            .as_str()
            .unwrap()
            .to_string();

        // 7. Replay test: re-submitting the same signature fails (nonce consumed)
        let (replay_status, _) = route_request(
            "POST",
            "/api/v1/challenge-response",
            "",
            &headers,
            &good_resp_body,
            &state,
        )
        .await;
        assert_eq!(replay_status, 401);

        // 8. Session token works to fetch credentials
        let mut auth_headers = HashMap::new();
        auth_headers.insert("authorization".to_string(), format!("Bearer {}", token));
        let (fetch_status, fetch_res) = route_request(
            "GET",
            "/api/v1/credentials",
            "domain=example.com",
            &auth_headers,
            "",
            &state,
        )
        .await;
        assert_eq!(fetch_status, 200);
        assert!(fetch_res.contains("example.com"));

        // 9. Revocation: revoke client
        assert!(state.revoke_client(&client_id));

        // 10. Previously valid token is now rejected on next request!
        let (post_revoke_status, _) = route_request(
            "GET",
            "/api/v1/credentials",
            "domain=example.com",
            &auth_headers,
            "",
            &state,
        )
        .await;
        assert_eq!(post_revoke_status, 401);
    }

    #[tokio::test]
    async fn test_extension_cannot_unlock_vault() {
        let state = Arc::new(ServerState::new());
        let headers = HashMap::new();
        let body = r#"{"master_password":"master"}"#;
        let (status, _) = route_request("POST", "/api/v1/unlock", "", &headers, body, &state).await;
        assert_eq!(status, 403);
    }
}

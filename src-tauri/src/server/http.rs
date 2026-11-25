use super::*;
use std::net::SocketAddr;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// Verifica que un header Origin prové exactament d'un loopback.
///
/// Comparar prefixos acceptaria `http://localhost.evil.com`; aquí es parseja
/// l'autoritat i es compara el host sencer.
pub(super) fn is_loopback_origin(origin: &str) -> bool {
    let Some(rest) = origin.strip_prefix("http://") else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() {
        return false;
    }
    let host = if let Some(stripped) = authority.strip_prefix('[') {
        stripped.split(']').next().unwrap_or("")
    } else {
        authority.split(':').next().unwrap_or("")
    };
    matches!(host, "127.0.0.1" | "localhost" | "::1")
}

/// Verifica que el Content-Type és adequats per a peticions POST/PUT/PATCH amb cos.
pub(super) fn has_json_content_type(content_type: &str) -> bool {
    content_type.to_lowercase().contains("application/json")
}

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
                *state.server_error.lock().unwrap_or_else(|e| e.into_inner()) =
                    Some(message.clone());
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

    println!("SherLock Extension Server listening on http://{}", addr);

    loop {
        match listener.accept().await {
            Ok((mut stream, peer_addr)) => {
                let sem = Arc::clone(&state.connection_semaphore);
                let state_clone = Arc::clone(&state);
                tokio::spawn(async move {
                    match sem.acquire().await {
                        Ok(_permit) => {
                            handle_connection(stream, peer_addr, state_clone).await;
                        }
                        Err(_) => {
                            // Semaphore closed - server shutting down
                            let _ = stream
                                .write_all(b"HTTP/1.1 503 Service Unavailable\r\n\r\n")
                                .await;
                        }
                    }
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

    // Origin check: only loopback origins allowed (defense in depth)
    if let Some(origin) = headers.get("origin") {
        if !is_loopback_origin(origin) {
            let res = build_response(
                403,
                "application/json",
                r#"{"error":"Invalid Origin header"}"#,
            );
            let _ = stream.write_all(res.as_bytes()).await;
            return;
        }
    }

    // Exigeix Content-Type: application/json per peticions que enviin cos JSON,
    // per evitar que una pàgina web trigui Argon2 (64 MiB) amb un "simple
    // request" de formulari HTML.
    if matches!(method.as_str(), "POST" | "PUT" | "PATCH") && !body.is_empty() {
        let content_type = headers.get("content-type").cloned().unwrap_or_default();
        if !has_json_content_type(&content_type) {
            let res = build_response(
                415,
                "application/json",
                r#"{"error":"Content-Type must be application/json"}"#,
            );
            let _ = stream.write_all(res.as_bytes()).await;
            return;
        }
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
        let read_result =
            tokio::time::timeout(std::time::Duration::from_secs(5), stream.read(&mut chunk)).await;
        let read = match read_result {
            Ok(Ok(n)) => n,
            Ok(Err(_)) => return Err((400, "Failed to read request")),
            Err(_) => return Err((408, "Request timeout")),
        };
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
        let read_result =
            tokio::time::timeout(std::time::Duration::from_secs(5), stream.read(&mut chunk)).await;
        let read = match read_result {
            Ok(Ok(n)) => n,
            Ok(Err(_)) => return Err((400, "Failed to read request body")),
            Err(_) => return Err((408, "Request timeout")),
        };
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
    if (path == "/health" || path == "/api/v1/health") && method == "GET" {
        let res = serde_json::json!({
            "status": "healthy",
            "app": "SherLock",
            "version": "1.0.0"
        });
        return (200, res.to_string());
    }

    if path == "/api/v1/vault-info" && method == "GET" {
        if !check_request_auth(headers, state) {
            return (
                401,
                r#"{"success":false,"error":"Authentication required"}"#.to_string(),
            );
        }
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
        let mut pc_guard = state.pairing_code.lock().unwrap_or_else(|e| e.into_inner());
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
            .unwrap_or_else(|e| e.into_inner())
            .insert(client_id.clone());

        let res = serde_json::json!({
            "success": true,
            "client_id": client_id,
            "message": "Device paired successfully"
        });
        return (200, res.to_string());
    }

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
            .unwrap_or_else(|e| e.into_inner())
            .insert(client_id, (nonce.clone(), expires_at));

        let res = serde_json::json!({
            "success": true,
            "nonce": nonce
        });
        return (200, res.to_string());
    }

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
        let pending = state
            .pending_challenges
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(client_id);
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

        state
            .authorized_clients
            .lock()
            .unwrap_or_else(|e| e.into_inner())
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

    // The extension cannot unlock the vault; unlock happens in the desktop app.
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
        if !check_request_auth(headers, state) {
            return (
                401,
                r#"{"success":false,"error":"Authentication required"}"#.to_string(),
            );
        }
        let parsed: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
        let length = parsed["length"].as_u64().unwrap_or(16).clamp(8, 128) as u32;
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
        let unlocked = state
            .unlocked_data
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let vault = match &*unlocked {
            Some(v) => v,
            None => {
                return (
                    401,
                    r#"{"success":false,"unlocked":false,"error":"Vault is locked"}"#.to_string(),
                );
            }
        };
        let entries: Vec<serde_json::Value> = vault
            .entries
            .iter()
            .map(|e| {
                serde_json::json!({
                    "id": e.id, "site": e.site, "username": e.username
                })
            })
            .collect();
        return (
            200,
            serde_json::json!({"success":true,"unlocked":true,"credentials":entries}).to_string(),
        );
    }

    if path == "/api/v1/credentials" && method == "GET" {
        let unlocked = state
            .unlocked_data
            .lock()
            .unwrap_or_else(|e| e.into_inner());
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
        // Serialized writes: actually acquire the semaphore.
        let _permit = match state.write_semaphore.acquire().await {
            Ok(p) => p,
            Err(e) => {
                return (
                    500,
                    serde_json::json!({"success":false,"error":e.to_string()}).to_string(),
                )
            }
        };

        let mut unlocked = state
            .unlocked_data
            .lock()
            .unwrap_or_else(|e| e.into_inner());
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
        let force_new = parsed["force_new"].as_bool().unwrap_or(false);
        let entry_id = parsed["id"].as_str().unwrap_or("").trim();

        if site.is_empty() || password.is_empty() {
            return (
                400,
                r#"{"success":false,"error":"Site and password are required"}"#.to_string(),
            );
        }

        let existing_index = if force_new {
            None
        } else if !entry_id.is_empty() {
            vault.entries.iter().position(|e| e.id == entry_id)
        } else {
            vault.entries.iter().position(|e| {
                e.site.eq_ignore_ascii_case(site) && e.username.eq_ignore_ascii_case(username)
            })
        };

        if !entry_id.is_empty() && existing_index.is_none() {
            return (
                404,
                r#"{"success":false,"error":"Credential not found"}"#.to_string(),
            );
        }

        let saved_entry = match existing_index {
            Some(idx) => {
                let existing = &mut vault.entries[idx];
                if !entry_id.is_empty() {
                    existing.site = site.to_string();
                    existing.username = username.to_string();
                }
                existing.password = password.to_string();
                if !entry_id.is_empty() || !notes.is_empty() {
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
            cloud_session: vault.cloud_session.clone(),
        };

        if let Err(e) = save_vault_data(&vault.master_password, &vault_data) {
            return (
                500,
                serde_json::json!({ "success": false, "error": e }).to_string(),
            );
        }

        if let Some(handle) = state
            .app_handle
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
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

    if path == "/api/v1/credentials" && method == "DELETE" {
        if !check_request_auth(headers, state) {
            return (
                401,
                r#"{"success":false,"error":"Authentication required"}"#.to_string(),
            );
        }
        let parsed: serde_json::Value = match serde_json::from_str(body) {
            Ok(value) => value,
            Err(_) => return (400, r#"{"error":"Invalid JSON body"}"#.to_string()),
        };
        let entry_id = parsed["id"].as_str().unwrap_or("").trim();
        if entry_id.is_empty() {
            return (
                400,
                r#"{"success":false,"error":"Credential id is required"}"#.to_string(),
            );
        }

        let _permit = match state.write_semaphore.acquire().await {
            Ok(permit) => permit,
            Err(error) => {
                return (
                    500,
                    serde_json::json!({"success": false, "error": error.to_string()}).to_string(),
                )
            }
        };
        let mut unlocked = state
            .unlocked_data
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let vault = match &mut *unlocked {
            Some(vault) => vault,
            None => {
                return (
                    401,
                    r#"{"success":false,"unlocked":false,"error":"Vault is locked"}"#.to_string(),
                )
            }
        };
        let Some(index) = vault.entries.iter().position(|entry| entry.id == entry_id) else {
            return (
                404,
                r#"{"success":false,"error":"Credential not found"}"#.to_string(),
            );
        };
        let removed = vault.entries.remove(index);
        let vault_data = VaultData {
            entries: vault.entries.clone(),
            folders: vault.folders.clone(),
            deleted_entries: vault.trash.clone(),
            history: vault.history.clone(),
            cloud_session: vault.cloud_session.clone(),
        };
        if let Err(error) = save_vault_data(&vault.master_password, &vault_data) {
            return (
                500,
                serde_json::json!({"success": false, "error": error}).to_string(),
            );
        }
        if let Some(handle) = state
            .app_handle
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .as_ref()
        {
            use tauri::Emitter;
            let _ = handle.emit("vault-updated", serde_json::json!({"deleted": removed.id}));
        }
        return (
            200,
            serde_json::json!({"success": true, "deleted_id": removed.id}).to_string(),
        );
    }

    (404, r#"{"error":"Not Found"}"#.to_string())
}

fn check_request_auth(headers: &HashMap<String, String>, state: &Arc<ServerState>) -> bool {
    if let Some(auth_val) = headers.get("authorization") {
        if let Some(token) = auth_val.strip_prefix("Bearer ") {
            return state.validate_token(token.trim());
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

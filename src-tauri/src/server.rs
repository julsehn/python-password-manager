mod http;
pub use http::{route_request, save_vault_data, start_server};

use chrono::Utc;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
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
    pub client_sessions: Mutex<HashMap<String, SessionToken>>, // token -> SessionToken
    pub write_semaphore: Arc<tokio::sync::Semaphore>,
    pub app_handle: Mutex<Option<tauri::AppHandle>>,
    pub pairing_code: Mutex<Option<PairingCode>>,
    pub pending_challenges: Mutex<HashMap<String, (String, i64)>>, // client_id -> (nonce_hex, expires_at)
    pub authorized_clients: Mutex<HashSet<String>>, // client_id authorized in current session
    pub server_error: Mutex<Option<String>>,
    pub connection_semaphore: Arc<tokio::sync::Semaphore>,
}

impl Default for ServerState {
    fn default() -> Self {
        Self::new()
    }
}

impl ServerState {
    pub fn new() -> Self {
        let write_sem = Arc::new(tokio::sync::Semaphore::new(1));
        let connection_sem = Arc::new(tokio::sync::Semaphore::new(32));
        Self {
            unlocked_data: Mutex::new(None),
            client_sessions: Mutex::new(HashMap::new()),
            write_semaphore: write_sem,
            app_handle: Mutex::new(None),
            pairing_code: Mutex::new(None),
            pending_challenges: Mutex::new(HashMap::new()),
            authorized_clients: Mutex::new(HashSet::new()),
            server_error: Mutex::new(None),
            connection_semaphore: connection_sem,
        }
    }

    pub fn set_app_handle(&self, handle: tauri::AppHandle) {
        let mut app_handle = self.app_handle.lock().unwrap_or_else(|e| e.into_inner());
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
        let mut data = self.unlocked_data.lock().unwrap_or_else(|e| e.into_inner());
        *data = Some(UnlockedVault {
            master_password: Zeroizing::new(master_password),
            entries,
            folders,
            trash,
            history,
        });
    }

    pub fn lock(&self) {
        let mut data = self.unlocked_data.lock().unwrap_or_else(|e| e.into_inner());
        *data = None;
        let mut sessions = self
            .client_sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        sessions.clear();
        let mut auth = self
            .authorized_clients
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        auth.clear();
        let mut challenges = self
            .pending_challenges
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        challenges.clear();
    }

    pub fn is_unlocked(&self) -> bool {
        self.unlocked_data
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some()
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

        let mut sessions = self
            .client_sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let now = Utc::now().timestamp();
        sessions.retain(|_, s| s.expires_at > now);
        sessions.insert(token.clone(), st);

        token
    }

    pub fn validate_token(&self, token_to_check: &str) -> bool {
        let now = Utc::now().timestamp();
        let sessions = self
            .client_sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
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

        let mut pc = self.pairing_code.lock().unwrap_or_else(|e| e.into_inner());
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

        let mut sessions = self
            .client_sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        sessions.retain(|_, st| st.client_id.as_deref() != Some(client_id));

        let mut auth = self
            .authorized_clients
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        auth.remove(client_id);

        let mut challenges = self
            .pending_challenges
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        challenges.remove(client_id);

        true
    }
}

pub fn get_paired_clients_path() -> PathBuf {
    if let Ok(p) = std::env::var("SHERLOCK_PAIRED_CLIENTS_PATH") {
        return PathBuf::from(p);
    }
    config_dir().join("paired_clients.json")
}

pub fn load_paired_clients() -> Vec<PairedClient> {
    let path = get_paired_clients_path();
    match std::fs::read_to_string(&path) {
        Ok(c) => serde_json::from_str(&c).unwrap_or_default(),
        // No es fa fallback a temp_dir(): /tmp és compartit entre usuaris a
        // Linux i un atacant podria plantar un fitxer de clients aparellats.
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
        Err(e) => Err(format!("Failed to write paired clients: {e}")),
    }
}

// ── ECDSA P-256 verification ────────

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

// ── Domain matching ──────────────────

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

#[cfg(test)]
mod tests {
    use super::http::{has_json_content_type, is_loopback_origin};
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
            let lock = PAIRED_CLIENTS_TEST_LOCK
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            let directory = tempfile::tempdir().unwrap();
            let previous_path = std::env::var_os("SHERLOCK_PAIRED_CLIENTS_PATH");
            std::env::set_var(
                "SHERLOCK_PAIRED_CLIENTS_PATH",
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
                Some(path) => std::env::set_var("SHERLOCK_PAIRED_CLIENTS_PATH", path),
                None => std::env::remove_var("SHERLOCK_PAIRED_CLIENTS_PATH"),
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
                },
            ],
            vec![],
            vec![],
            vec![],
        );

        let token = state.create_session_token();
        let mut headers = HashMap::new();
        headers.insert("authorization".to_string(), format!("Bearer {}", token));

        let (index_status, index_body) =
            route_request("GET", "/api/v1/credentials/index", "", &headers, "", &state).await;
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

    // Old handshake endpoint removed. Test converted to: route does not exist.

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

    #[test]
    fn test_is_loopback_origin() {
        // Loopback origins should be allowed
        assert!(is_loopback_origin("http://127.0.0.1:8080"));
        assert!(is_loopback_origin("http://127.0.0.1"));
        assert!(is_loopback_origin("http://localhost:8080"));
        assert!(is_loopback_origin("http://localhost"));

        // Non-loopback origins should be rejected
        assert!(!is_loopback_origin("http://example.com"));
        assert!(!is_loopback_origin("http://evil.com:8080"));
        assert!(!is_loopback_origin("https://example.com"));
        assert!(!is_loopback_origin("http://192.168.1.1"));
    }

    #[test]
    fn test_has_json_content_type() {
        // Valid JSON content types
        assert!(has_json_content_type("application/json"));
        assert!(has_json_content_type("application/json; charset=utf-8"));
        assert!(has_json_content_type("APPLICATION/JSON"));

        // Invalid content types
        assert!(!has_json_content_type("text/plain"));
        assert!(!has_json_content_type("application/xml"));
        assert!(!has_json_content_type("text/html"));
        assert!(!has_json_content_type(""));
    }
}

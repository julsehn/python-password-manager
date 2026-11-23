use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

pub const DEFAULT_OFFICIAL_URL: &str = "https://password-manager-cloud-production.up.railway.app";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SyncConfig {
    pub railway_url: String,
    pub vault_id: String,
    pub token: String,
    #[serde(default)]
    pub refresh_token: String,
    #[serde(default)]
    pub cloud_version: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncResponse {
    pub success: bool,
    pub message: String,
    pub timestamp: u64,
    pub error: Option<String>,
    #[serde(default)]
    pub version: Option<i64>,
}

/// Resposta de l'ordre única de sincronització (`sync_vault_auto` /
/// `sync_resolve_conflict`). Els camps van en snake_case com `SyncResponse`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncAutoResponse {
    pub outcome: String,
    pub message: String,
    pub timestamp: u64,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub version: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthResponseData {
    pub user_id: i64,
    pub username: String,
    pub email: Option<String>,
    pub access_token: String,
    pub refresh_token: String,
    pub vault_id: String,
    pub token_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct UserAuthRequest {
    username: String,
    password: String,
}

#[derive(Debug, Deserialize)]
struct UsernameAvailabilityResponse {
    available: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct VaultBlob {
    blob: String,
    expected_version: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct VaultResponse {
    vault_id: String,
    blob: String,
    version: i64,
    updated_at: String,
}

/// Resultat d'una pujada al núvol. El conflict (409) indica que la caixa al
/// núbol és més nova que la local i no s'ha sobreescrit res.
#[derive(Debug)]
pub enum UploadResult {
    Ok(SyncResponse, i64),
    Conflict,
}

/// Decisió de sincronització pura (sense HTTP), basada en estat local i remot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncAction {
    /// Local i núbol estan al dia.
    UpToDate,
    /// Pujar la caixa local al núbol.
    Upload,
    /// Baixar la caixa del núbol sobre la local.
    Download,
    /// Conflicte: ambdues tenen canvis no reconciliats. No s'escriu res.
    Conflict,
}

/// Taula de decisió per a la sincronització automàtica.
///
/// Regles:
/// - núbol sense caixa (`remote_version == None`) → `Upload`
///   (excepte si no hi ha versió local coneguda ni caixa remota → `Upload` de caixa nova)
/// - local sense canvis i `known_version == remote_version` → `UpToDate`
/// - local amb canvis i `known_version == remote_version` → `Upload`
/// - local sense canvis i `remote_version > known_version` → `Download`
/// - local amb canvis i `remote_version > known_version` → `Conflict`
/// - `known_version == None` i núbol té caixa → `Conflict` (mai pujar a cegues)
/// - `known_version > remote_version` (núbol reiniciat) → `Conflict`
pub fn decide_sync_action(
    local_changed: bool,
    known_version: Option<i64>,
    remote_version: Option<i64>,
) -> SyncAction {
    match (known_version, remote_version) {
        (_, None) => SyncAction::Upload,
        (None, Some(_)) => SyncAction::Conflict,
        (Some(k), Some(r)) if k == r => {
            if local_changed {
                SyncAction::Upload
            } else {
                SyncAction::UpToDate
            }
        }
        (Some(k), Some(r)) if r > k => {
            if local_changed {
                SyncAction::Conflict
            } else {
                SyncAction::Download
            }
        }
        (Some(k), Some(_)) if k > remote_version.unwrap_or(0) => SyncAction::Conflict,
        _ => SyncAction::Conflict,
    }
}

fn http_client(timeout_seconds: u64) -> Result<Client, String> {
    Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(timeout_seconds))
        .build()
        .map_err(|error| format!("Error en crear client HTTP: {}", error))
}

async fn error_details(response: reqwest::Response) -> (reqwest::StatusCode, String) {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    (status, body)
}

#[derive(Debug, Serialize)]
struct RefreshRequest<'a> {
    refresh_token: &'a str,
}

async fn get_access_token(
    client: &Client,
    base_url: &str,
    config: &SyncConfig,
) -> Result<String, String> {
    if config.refresh_token.is_empty() {
        return Err("No s'ha configurat el refresh token segur de Railway".to_string());
    }

    let response = client
        .post(format!("{}/v1/auth/refresh", base_url))
        .json(&RefreshRequest {
            refresh_token: &config.refresh_token,
        })
        .send()
        .await
        .map_err(|error| format!("Error en actualitzar la sessió de Railway: {}", error))?;
    if !response.status().is_success() {
        let (status, body) = error_details(response).await;
        return Err(format!(
            "La sessió de Railway ha caducat ({}): {}",
            status, body
        ));
    }
    let auth: AuthResponseData = response
        .json()
        .await
        .map_err(|error| format!("Error en descodificar la sessió de Railway: {}", error))?;
    Ok(auth.access_token)
}

fn resolve_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim().trim_end_matches('/');
    let candidate = if trimmed.is_empty() {
        DEFAULT_OFFICIAL_URL.to_string()
    } else {
        trimmed.to_string()
    };
    if candidate.starts_with("https://") {
        return Ok(candidate);
    }
    if let Some(rest) = candidate.strip_prefix("http://") {
        let authority = rest.split('/').next().unwrap_or("");
        let host = authority.split(':').next().unwrap_or("");
        if matches!(host, "127.0.0.1" | "localhost" | "[::1]") {
            return Ok(candidate);
        }
    }
    Err("La URL del núvol ha de ser HTTPS (només es permet HTTP a loopback)".to_string())
}

pub async fn auth_user(
    username: &str,
    password: &str,
    custom_url: Option<&str>,
) -> Result<AuthResponseData, String> {
    let base_url = resolve_url(custom_url.unwrap_or(DEFAULT_OFFICIAL_URL))?;
    let endpoint = format!("{}/v1/auth/login", base_url);

    let client = http_client(30)?;

    let response = client
        .post(&endpoint)
        .json(&UserAuthRequest {
            username: username.to_string(),
            password: password.to_string(),
        })
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("Error de connexió amb Railway ({}): {}", base_url, e))?;

    if !response.status().is_success() {
        let (status, body) = error_details(response).await;
        return Err(format!("Error d'autenticació ({}): {}", status, body));
    }

    let auth_data: AuthResponseData = response
        .json()
        .await
        .map_err(|e| format!("Error en descodificar resposta de Railway: {}", e))?;

    Ok(auth_data)
}

pub async fn register_user(
    username: &str,
    password: &str,
    custom_url: Option<&str>,
) -> Result<AuthResponseData, String> {
    let base_url = resolve_url(custom_url.unwrap_or(DEFAULT_OFFICIAL_URL))?;
    let endpoint = format!("{}/v1/auth/register", base_url);

    let client = http_client(30)?;

    let response = client
        .post(&endpoint)
        .json(&UserAuthRequest {
            username: username.to_string(),
            password: password.to_string(),
        })
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("Error de connexió amb Railway ({}): {}", base_url, e))?;

    if !response.status().is_success() {
        let (status, body) = error_details(response).await;
        return Err(format!("Error en el registre ({}): {}", status, body));
    }

    let auth_data: AuthResponseData = response
        .json()
        .await
        .map_err(|e| format!("Error en descodificar resposta de Railway: {}", e))?;

    Ok(auth_data)
}

fn username_availability_url(base_url: &str, username: &str) -> Result<reqwest::Url, String> {
    let mut endpoint = reqwest::Url::parse(base_url)
        .map_err(|error| format!("URL de Railway no vàlida: {}", error))?;
    let mut path = endpoint
        .path_segments_mut()
        .map_err(|_| "URL de Railway no vàlida".to_string())?;
    path.pop_if_empty();
    path.push("v1");
    path.push("auth");
    path.push("check-username");
    path.push(username);
    drop(path);
    Ok(endpoint)
}

pub async fn check_username_availability(
    username: &str,
    custom_url: Option<&str>,
) -> Result<bool, String> {
    let base_url = resolve_url(custom_url.unwrap_or(DEFAULT_OFFICIAL_URL))?;
    let endpoint = username_availability_url(&base_url, username)?;
    let client = http_client(15)?;
    let response = client
        .get(endpoint)
        .send()
        .await
        .map_err(|error| format!("Error de connexió amb Railway ({}): {}", base_url, error))?;
    if !response.status().is_success() {
        let (status, body) = error_details(response).await;
        return Err(format!(
            "Error en comprovar el nom d'usuari ({}): {}",
            status, body
        ));
    }
    let result: UsernameAvailabilityResponse = response
        .json()
        .await
        .map_err(|error| format!("Error en llegir la resposta de Railway: {}", error))?;
    Ok(result.available)
}

pub async fn revoke_refresh_token(config: &SyncConfig) -> Result<(), String> {
    if config.refresh_token.is_empty() {
        return Ok(());
    }
    let base_url = resolve_url(&config.railway_url)?;
    let client = http_client(30)?;
    let response = client
        .post(format!("{}/v1/auth/logout", base_url))
        .json(&RefreshRequest {
            refresh_token: &config.refresh_token,
        })
        .send()
        .await
        .map_err(|error| format!("Error en revocar la sessió de Railway: {}", error))?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!(
            "No s'ha pogut revocar la sessió de Railway ({})",
            response.status()
        ))
    }
}

fn build_vault_payload(blob: String, cloud_version: Option<i64>) -> VaultBlob {
    VaultBlob {
        blob,
        expected_version: cloud_version,
    }
}

pub(crate) fn parse_upload_status(
    status: reqwest::StatusCode,
    body: &str,
) -> Result<UploadResult, String> {
    if status == reqwest::StatusCode::CONFLICT {
        return Ok(UploadResult::Conflict);
    }

    if !status.is_success() {
        return Err(format!("Error en pujar SherLock ({}) : {}", status, body));
    }

    let vault_response: VaultResponse = serde_json::from_str(body)
        .map_err(|e| format!("Error en interpretar la resposta del servidor: {}", e))?;

    Ok(UploadResult::Ok(
        SyncResponse {
            success: true,
            message: "Caixa sincronitzada correctament amb Railway".to_string(),
            timestamp: chrono::Utc::now().timestamp() as u64,
            error: None,
            version: Some(vault_response.version),
        },
        vault_response.version,
    ))
}

pub(crate) fn parse_download_response(
    status: reqwest::StatusCode,
    body: &str,
) -> Result<(String, i64), String> {
    if !status.is_success() {
        return Err(format!(
            "Error en descarregar SherLock ({}): {}",
            status, body
        ));
    }

    let vault_response: VaultResponse = serde_json::from_str(body)
        .map_err(|e| format!("Error en interpretar la resposta del servidor: {}", e))?;

    Ok((vault_response.blob, vault_response.version))
}

pub async fn upload_vault(config: &SyncConfig) -> Result<UploadResult, String> {
    let base_url = resolve_url(&config.railway_url)?;

    let client = http_client(30)?;
    let access_token = get_access_token(&client, &base_url, config).await?;

    let vault_path = crate::vault_path();

    if !std::path::Path::new(&vault_path).exists() {
        return Err("No s'ha trobat l'arxiu local de SherLock.".to_string());
    }

    let content = std::fs::read_to_string(&vault_path)
        .map_err(|e| format!("Error en llegir SherLock: {}", e))?;

    let payload = build_vault_payload(content, config.cloud_version);

    let url = if config.vault_id.is_empty() {
        format!("{}/v1/vault", base_url)
    } else {
        format!("{}/v1/vaults/{}", base_url, config.vault_id)
    };

    let response = client
        .put(&url)
        .json(&payload)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("Error en connectar amb Railway: {}", e))?;

    let (status, body) = error_details(response).await;
    parse_upload_status(status, &body)
}

pub async fn download_vault(
    _master_password: String,
    config: &SyncConfig,
) -> Result<(String, i64), String> {
    let base_url = resolve_url(&config.railway_url)?;

    let client = http_client(30)?;
    let access_token = get_access_token(&client, &base_url, config).await?;

    let url = if config.vault_id.is_empty() {
        format!("{}/v1/vault", base_url)
    } else {
        format!("{}/v1/vaults/{}", base_url, config.vault_id)
    };

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("Error en connectar amb Railway: {}", e))?;

    let (status, body) = error_details(response).await;
    parse_download_response(status, &body)
}

/// Obté la versió remota de la caixa sense baixar-la.
/// Utilitza GET /v1/auth/me amb un access token fresc obtingut via refresh token.
pub async fn remote_vault_version(config: &SyncConfig) -> Result<Option<i64>, String> {
    let base_url = resolve_url(&config.railway_url)?;

    let client = http_client(30)?;
    let access_token = get_access_token(&client, &base_url, config).await?;

    let response = client
        .get(format!("{}/v1/auth/me", base_url))
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("Error en connectar amb Railway: {e}"))?;

    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        // L'usuari no té caixa al núbol (compte nou sense primera pujada).
        return Ok(None);
    }
    if !status.is_success() {
        let (_, body) = error_details(response).await;
        return Err(format!(
            "Error al consultar la versió remota ({}): {status}",
            body
        ));
    }

    let body = response.text().await.unwrap_or_default();
    let value: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("Error al interpretar la versió remota: {e}"))?;

    let has_vault = value
        .get("has_vault")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let version = value.get("vault_version").and_then(|v| v.as_i64());

    match (has_vault, version) {
        (true, Some(v)) if v > 0 => Ok(Some(v)),
        (true, Some(0)) | (false, _) => Ok(None),
        (true, None) => Ok(None),
        _ => Ok(None),
    }
}

pub async fn delete_vault(_master_password: String, config: &SyncConfig) -> Result<bool, String> {
    let base_url = resolve_url(&config.railway_url)?;

    if config.vault_id.is_empty() {
        return Err("L'identificador de SherLock no pot estar buit".to_string());
    }

    let client = http_client(30)?;
    let access_token = get_access_token(&client, &base_url, config).await?;

    let response = client
        .delete(format!("{}/v1/vaults/{}", base_url, config.vault_id))
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("Error en connectar amb Railway: {}", e))?;

    let status = response.status();
    match status {
        reqwest::StatusCode::NO_CONTENT => Ok(true),
        reqwest::StatusCode::NOT_FOUND => Ok(false),
        _ => {
            let (_, body) = error_details(response).await;
            Err(format!("Error en eliminar SherLock ({}): {}", status, body))
        }
    }
}

/// Elimina el compte d'usuari autenticat al servidor Railway (GDPR right to erasure).
/// Obté un access token fresc amb el refresh token.
pub async fn delete_user_account(config: &SyncConfig) -> Result<(), String> {
    let base_url = resolve_url(&config.railway_url)?;
    let client = http_client(30)?;
    let access_token = get_access_token(&client, &base_url, config).await?;
    let response = client
        .delete(format!("{}/v1/auth/me", base_url))
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("Error en connectar amb Railway: {e}"))?;
    let status = response.status();
    match status {
        reqwest::StatusCode::NO_CONTENT => Ok(()),
        reqwest::StatusCode::NOT_FOUND => Ok(()), // compte ja no existeix
        _ => {
            let (_, body) = error_details(response).await;
            Err(format!(
                "Error en eliminar el compte al núvol ({}): {}",
                status, body
            ))
        }
    }
}

pub async fn check_health(railway_url: Option<&str>) -> Result<bool, String> {
    let base_url = resolve_url(railway_url.unwrap_or(DEFAULT_OFFICIAL_URL))?;

    let client = http_client(10)?;

    let response = client
        .get(format!("{}/healthz", base_url))
        .send()
        .await
        .map_err(|e| format!("Error en connectar amb Railway ({}): {}", base_url, e))?;

    Ok(response.status().is_success())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::await_holding_lock)]
    use super::*;
    use crate::TEST_ENV_LOCK as RAILWAY_TEST_LOCK;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn test_vault_blob_serialization() {
        let blob_with_version = VaultBlob {
            blob: "encrypted_data".to_string(),
            expected_version: Some(5),
        };
        let json = serde_json::to_string(&blob_with_version).unwrap();
        assert!(json.contains("\"expected_version\":5"));

        let blob_without_version = VaultBlob {
            blob: "encrypted_data".to_string(),
            expected_version: None,
        };
        let json_none = serde_json::to_string(&blob_without_version).unwrap();
        assert!(json_none.contains("\"expected_version\":null"));
    }

    #[test]
    fn test_sync_config_version_deserialization() {
        let json_with_version =
            r#"{"railway_url":"http://test","vault_id":"v1","token":"t1","cloud_version":12}"#;
        let config: SyncConfig = serde_json::from_str(json_with_version).unwrap();
        assert_eq!(config.cloud_version, Some(12));

        let json_no_version = r#"{"railway_url":"http://test","vault_id":"v1","token":"t1"}"#;
        let config_default: SyncConfig = serde_json::from_str(json_no_version).unwrap();
        assert_eq!(config_default.cloud_version, None);
    }

    #[test]
    fn username_availability_url_matches_cloud_api_route() {
        let expected =
            "https://password-manager-cloud-production.up.railway.app/v1/auth/check-username/TheUser";

        let with_trailing_slash = username_availability_url(
            "https://password-manager-cloud-production.up.railway.app/",
            "TheUser",
        )
        .unwrap();
        assert_eq!(with_trailing_slash.as_str(), expected);

        // The previous implementation pushed the username onto a base URL that
        // ended in `/`, which produced `/check-username//TheUser`. FastAPI
        // redirects that path, so the client followed it instead of failing
        // loudly. Keep the exact single-slash route.
        let without_trailing_slash = username_availability_url(
            "https://password-manager-cloud-production.up.railway.app",
            "TheUser",
        )
        .unwrap();
        assert_eq!(without_trailing_slash, with_trailing_slash);
        assert!(!with_trailing_slash.as_str().contains("//TheUser"));
    }

    async fn read_full_http_request(
        stream: &mut tokio::net::TcpStream,
    ) -> Option<(String, String, String)> {
        let mut data = Vec::with_capacity(4096);
        let mut buf = [0u8; 1024];
        let header_end = loop {
            if let Some(pos) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                break pos;
            }
            let n = stream.read(&mut buf).await.ok()?;
            if n == 0 {
                return None;
            }
            data.extend_from_slice(&buf[..n]);
        };

        let header_str = String::from_utf8_lossy(&data[..header_end]).to_string();
        let mut lines = header_str.lines();
        let first_line = lines.next().unwrap_or("");
        let parts: Vec<&str> = first_line.split_whitespace().collect();
        let method = parts.first().copied().unwrap_or("").to_string();
        let path = parts.get(1).copied().unwrap_or("").to_string();

        let mut content_length: usize = 0;
        for line in lines {
            if let Some((k, v)) = line.split_once(':') {
                if k.trim().eq_ignore_ascii_case("content-length") {
                    content_length = v.trim().parse().unwrap_or(0);
                }
            }
        }

        let body_start = header_end + 4;
        let mut body_bytes = data[body_start..].to_vec();
        while body_bytes.len() < content_length {
            let n = stream.read(&mut buf).await.ok()?;
            if n == 0 {
                break;
            }
            body_bytes.extend_from_slice(&buf[..n]);
        }

        let body = String::from_utf8_lossy(&body_bytes).to_string();
        Some((method, path, body))
    }

    async fn spawn_mock_railway_server() -> (
        String,
        tokio::task::JoinHandle<()>,
        tokio::sync::mpsc::Receiver<(String, String)>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let base_url = format!("http://127.0.0.1:{}", port);
        let (tx, rx) = tokio::sync::mpsc::channel(10);

        let handle = tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let tx = tx.clone();
                tokio::spawn(async move {
                    while let Some((method, path, body)) = read_full_http_request(&mut stream).await
                    {
                        let _ = tx
                            .send((format!("{} {}", method, path), body.clone()))
                            .await;

                        let resp = if path.ends_with("/v1/auth/refresh") {
                            let resp_body = serde_json::json!({
                                "user_id": 1,
                                "username": "tester",
                                "access_token": "mock-access-token",
                                "refresh_token": "mock-refresh-token",
                                "vault_id": "test-vault",
                                "token_type": "bearer"
                            })
                            .to_string();
                            format!(
                                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: keep-alive\r\n\r\n{}",
                                resp_body.len(),
                                resp_body
                            )
                        } else if method == "PUT" && path.contains("/v1/vaults/") {
                            if body.contains("\"expected_version\":999") {
                                "HTTP/1.1 409 Conflict\r\nContent-Type: application/json\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n".to_string()
                            } else {
                                let resp_body = serde_json::json!({
                                    "vault_id": "test-vault",
                                    "blob": "encrypted_blob_cloud",
                                    "version": 5,
                                    "updated_at": "2026-11-20T08:00:00Z"
                                })
                                .to_string();
                                format!(
                                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: keep-alive\r\n\r\n{}",
                                    resp_body.len(),
                                    resp_body
                                )
                            }
                        } else if method == "GET" && path.contains("/v1/vaults/") {
                            let resp_body = serde_json::json!({
                                "vault_id": "test-vault",
                                "blob": "downloaded_vault_blob",
                                "version": 8,
                                "updated_at": "2026-11-20T08:00:00Z"
                            })
                            .to_string();
                            format!(
                                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: keep-alive\r\n\r\n{}",
                                resp_body.len(),
                                resp_body
                            )
                        } else if method == "DELETE" && path.contains("/v1/vaults/") {
                            if path.contains("nonexistent-vault") {
                                "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n".to_string()
                            } else {
                                "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n".to_string()
                            }
                        } else if method == "GET" && path == "/v1/auth/me" {
                            let resp_body = serde_json::json!({
                                "user_id": 1,
                                "username": "tester",
                                "email": None::<String>,
                                "vault_id": "test-vault",
                                "has_vault": true,
                                "vault_version": 5,
                                "updated_at": "2026-11-20T08:00:00Z"
                            })
                            .to_string();
                            format!(
                                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: keep-alive\r\n\r\n{}",
                                resp_body.len(),
                                resp_body
                            )
                        } else if method == "DELETE" && path.ends_with("/v1/auth/me") {
                            "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n".to_string()
                        } else {
                            "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n".to_string()
                        };

                        if stream.write_all(resp.as_bytes()).await.is_err() {
                            break;
                        }
                        if stream.flush().await.is_err() {
                            break;
                        }
                    }
                });
            }
        });

        (base_url, handle, rx)
    }

    #[tokio::test]
    async fn test_upload_vault_sends_expected_version_and_handles_conflict() {
        let _guard = RAILWAY_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());

        let temp_dir = tempfile::tempdir().unwrap();
        let test_vault_file = temp_dir.path().join("vault.json");
        std::fs::write(&test_vault_file, b"local_vault_content").unwrap();
        std::env::set_var("VAULT_PATH", &test_vault_file);

        let (mock_url, server_handle, mut rx) = spawn_mock_railway_server().await;

        let config = SyncConfig {
            railway_url: mock_url,
            vault_id: "test-vault".to_string(),
            token: "valid-token".to_string(),
            refresh_token: "valid-refresh-token".to_string(),
            cloud_version: Some(999), // Triggers mock 409 Conflict
        };

        let result = upload_vault(&config).await.unwrap();
        assert!(matches!(result, UploadResult::Conflict));

        let mut put_seen = false;
        while let Ok((req_line, body)) = rx.try_recv() {
            if req_line.starts_with("PUT") {
                put_seen = true;
                assert!(body.contains("\"expected_version\":999"));
            }
        }
        assert!(put_seen);

        std::env::remove_var("VAULT_PATH");
        server_handle.abort();
    }

    #[tokio::test]
    async fn test_upload_vault_success_returns_version() {
        let _guard = RAILWAY_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());

        let temp_dir = tempfile::tempdir().unwrap();
        let test_vault_file = temp_dir.path().join("vault.json");
        std::fs::write(&test_vault_file, b"local_vault_content").unwrap();
        std::env::set_var("VAULT_PATH", &test_vault_file);

        let (mock_url, server_handle, mut rx) = spawn_mock_railway_server().await;

        let config = SyncConfig {
            railway_url: mock_url,
            vault_id: "test-vault".to_string(),
            token: "valid-token".to_string(),
            refresh_token: "valid-refresh-token".to_string(),
            cloud_version: Some(4),
        };

        let result = upload_vault(&config).await.unwrap();
        match result {
            UploadResult::Ok(response, version) => {
                assert_eq!(version, 5);
                assert_eq!(response.version, Some(5));
                assert!(response.success);
            }
            UploadResult::Conflict => panic!("Expected UploadResult::Ok, got Conflict"),
        }

        let mut put_seen = false;
        while let Ok((req_line, body)) = rx.try_recv() {
            if req_line.starts_with("PUT") {
                put_seen = true;
                assert!(body.contains("\"expected_version\":4"));
            }
        }
        assert!(put_seen);

        std::env::remove_var("VAULT_PATH");
        server_handle.abort();
    }

    #[tokio::test]
    async fn test_download_vault_returns_blob_and_version() {
        let _guard = RAILWAY_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());

        let (mock_url, server_handle, _rx) = spawn_mock_railway_server().await;

        let config = SyncConfig {
            railway_url: mock_url,
            vault_id: "test-vault".to_string(),
            token: "valid-token".to_string(),
            refresh_token: "valid-refresh-token".to_string(),
            cloud_version: None,
        };

        let (blob, version) = download_vault("dummy-pwd".to_string(), &config)
            .await
            .unwrap();
        assert_eq!(blob, "downloaded_vault_blob");
        assert_eq!(version, 8);

        server_handle.abort();
    }

    #[tokio::test]
    async fn test_delete_user_account_refreshes_token_and_deletes() {
        let _guard = RAILWAY_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());

        let (mock_url, server_handle, mut rx) = spawn_mock_railway_server().await;

        let config = SyncConfig {
            railway_url: mock_url,
            vault_id: "test-vault".to_string(),
            token: "expired-token".to_string(),
            refresh_token: "valid-refresh-token".to_string(),
            cloud_version: None,
        };

        let result = delete_user_account(&config).await;
        assert!(result.is_ok());

        let mut refresh_seen = false;
        let mut delete_seen = false;
        while let Ok((req_line, _body)) = rx.try_recv() {
            if req_line.starts_with("POST") && req_line.contains("/v1/auth/refresh") {
                refresh_seen = true;
            }
            if req_line.starts_with("DELETE") && req_line.contains("/v1/auth/me") {
                delete_seen = true;
            }
        }
        assert!(refresh_seen, "Expected POST /v1/auth/refresh");
        assert!(delete_seen, "Expected DELETE /v1/auth/me");

        server_handle.abort();
    }

    #[tokio::test]
    async fn test_delete_vault_404_returns_false_not_error() {
        let _guard = RAILWAY_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());

        let (mock_url, server_handle, mut rx) = spawn_mock_railway_server().await;

        let config = SyncConfig {
            railway_url: mock_url,
            vault_id: "nonexistent-vault".to_string(),
            token: "expired-token".to_string(),
            refresh_token: "valid-refresh-token".to_string(),
            cloud_version: None,
        };

        let result = delete_vault("dummy-pwd".to_string(), &config).await;
        assert!(result.is_ok());
        assert!(!result.unwrap()); // 404 means vault not found, not an error

        let mut refresh_seen = false;
        while let Ok((req_line, _body)) = rx.try_recv() {
            if req_line.starts_with("POST") && req_line.contains("/v1/auth/refresh") {
                refresh_seen = true;
            }
        }
        assert!(refresh_seen, "Expected POST /v1/auth/refresh");

        server_handle.abort();
    }

    #[tokio::test]
    async fn test_remote_vault_version_returns_version() {
        let _guard = RAILWAY_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());

        let (mock_url, server_handle, _rx) = spawn_mock_railway_server().await;

        let config = SyncConfig {
            railway_url: mock_url,
            vault_id: "test-vault".to_string(),
            token: "valid-token".to_string(),
            refresh_token: "valid-refresh-token".to_string(),
            cloud_version: None,
        };

        let version = remote_vault_version(&config).await.unwrap();
        assert_eq!(version, Some(5));

        server_handle.abort();
    }

    #[test]
    fn test_decide_sync_action_table() {
        use super::SyncAction::*;
        let cases: &[(bool, Option<i64>, Option<i64>, SyncAction)] = &[
            (false, None, None, Upload),
            (true, None, None, Upload),
            (false, Some(5), Some(5), UpToDate),
            (true, Some(5), Some(5), Upload),
            (false, Some(5), Some(6), Download),
            (true, Some(5), Some(6), Conflict),
            (false, None, Some(6), Conflict),
            (true, None, Some(6), Conflict),
            (false, Some(6), Some(5), Conflict),
            (true, Some(6), Some(5), Conflict),
        ];
        for (local_changed, known_version, remote_version, expected) in cases {
            let got = decide_sync_action(*local_changed, *known_version, *remote_version);
            assert_eq!(
                got, *expected,
                "local_changed={local_changed:?}, known_version={known_version:?}, remote_version={remote_version:?}"
            );
        }
    }
}

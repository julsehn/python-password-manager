use reqwest::Client;
use serde::{Deserialize, Serialize};

pub const DEFAULT_OFFICIAL_URL: &str = "https://password-manager-cloud-production.up.railway.app";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SyncConfig {
    pub railway_url: String,
    pub vault_id: String,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncResponse {
    pub success: bool,
    pub message: String,
    pub timestamp: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthResponseData {
    pub user_id: i64,
    pub username: String,
    pub email: Option<String>,
    pub access_token: String,
    pub vault_id: String,
    pub token_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct UserAuthRequest {
    username: String,
    password: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct VaultRegistration {
    vault_id: String,
    token: String,
    blob: String,
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

fn resolve_url(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        DEFAULT_OFFICIAL_URL.to_string()
    } else {
        trimmed.to_string()
    }
}

pub async fn auth_user(
    username: &str,
    password: &str,
    custom_url: Option<&str>,
) -> Result<AuthResponseData, String> {
    let base_url = resolve_url(custom_url.unwrap_or(DEFAULT_OFFICIAL_URL));
    let endpoint = format!("{}/v1/auth/login", base_url);

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Error en crear client HTTP: {}", e))?;

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
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
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
    let base_url = resolve_url(custom_url.unwrap_or(DEFAULT_OFFICIAL_URL));
    let endpoint = format!("{}/v1/auth/register", base_url);

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Error en crear client HTTP: {}", e))?;

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
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Error en el registre ({}): {}", status, body));
    }

    let auth_data: AuthResponseData = response
        .json()
        .await
        .map_err(|e| format!("Error en descodificar resposta de Railway: {}", e))?;

    Ok(auth_data)
}

pub async fn upload_vault(
    _master_password: String,
    config: &SyncConfig,
) -> Result<SyncResponse, String> {
    let base_url = resolve_url(&config.railway_url);

    if config.token.is_empty() {
        return Err("No s'ha configurat el token d'autenticació de Railway".to_string());
    }

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Error en crear client HTTP: {}", e))?;

    let home = std::env::var("HOME").ok();
    let vault_path = home
        .as_ref()
        .map(|h| format!("{}/.password_manager/vault.json", h))
        .unwrap_or_else(|| "./vault.json".to_string());

    if !std::path::Path::new(&vault_path).exists() {
        return Err("No s'ha trobat l'arxiu local de la caixa forta.".to_string());
    }

    let content = std::fs::read_to_string(&vault_path)
        .map_err(|e| format!("Error en llegir la caixa forta: {}", e))?;

    let payload = VaultBlob {
        blob: content,
        expected_version: None,
    };

    let url = if config.vault_id.is_empty() {
        format!("{}/v1/vault", base_url)
    } else {
        format!("{}/v1/vaults/{}", base_url, config.vault_id)
    };

    let response = client
        .put(&url)
        .json(&payload)
        .header("Authorization", format!("Bearer {}", config.token))
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("Error en connectar amb Railway: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Error en pujar la caixa forta ({}) : {}", status, body));
    }

    let vault_response: VaultResponse = response
        .json()
        .await
        .map_err(|e| format!("Error en interpretar la resposta del servidor: {}", e))?;

    Ok(SyncResponse {
        success: true,
        message: format!(
            "Caixa forta sincronitzada correctament amb Railway (versió {})",
            vault_response.version
        ),
        timestamp: chrono::Utc::now().timestamp() as u64,
        error: None,
    })
}

pub async fn download_vault(
    _master_password: String,
    config: &SyncConfig,
) -> Result<String, String> {
    let base_url = resolve_url(&config.railway_url);

    if config.token.is_empty() {
        return Err("No s'ha configurat el token d'autenticació de Railway".to_string());
    }

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Error en crear client HTTP: {}", e))?;

    let url = if config.vault_id.is_empty() {
        format!("{}/v1/vault", base_url)
    } else {
        format!("{}/v1/vaults/{}", base_url, config.vault_id)
    };

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", config.token))
        .send()
        .await
        .map_err(|e| format!("Error en connectar amb Railway: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Error en descarregar la caixa forta ({}): {}", status, body));
    }

    let vault_response: VaultResponse = response
        .json()
        .await
        .map_err(|e| format!("Error en interpretar la resposta del servidor: {}", e))?;

    let home = std::env::var("HOME").ok();
    let vault_path = home
        .as_ref()
        .map(|h| format!("{}/.password_manager/vault.json", h))
        .unwrap_or_else(|| "./vault.json".to_string());

    if let Some(parent) = std::path::Path::new(&vault_path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    std::fs::write(&vault_path, vault_response.blob.clone())
        .map_err(|e| format!("Error en desar la caixa forta localment: {}", e))?;

    Ok(vault_response.blob)
}

pub async fn register_vault(
    _master_password: String,
    config: &SyncConfig,
) -> Result<SyncResponse, String> {
    let base_url = resolve_url(&config.railway_url);

    if config.vault_id.is_empty() {
        return Err("L'identificador de caixa forta no pot estar buit".to_string());
    }

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Error en crear client HTTP: {}", e))?;

    let payload = VaultRegistration {
        vault_id: config.vault_id.clone(),
        token: config.token.clone(),
        blob: String::new(),
    };

    let mut request = client
        .post(format!("{}/v1/vaults", base_url))
        .json(&payload)
        .header("Content-Type", "application/json");

    if !config.token.is_empty() {
        request = request.header("Authorization", format!("Bearer {}", config.token));
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Error en connectar amb Railway: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Error en registrar caixa forta ({}): {}", status, body));
    }

    let vault_response: VaultResponse = response
        .json()
        .await
        .map_err(|e| format!("Error en interpretar la resposta: {}", e))?;

    Ok(SyncResponse {
        success: true,
        message: format!(
            "Caixa forta registrada correctament a Railway (versió {})",
            vault_response.version
        ),
        timestamp: chrono::Utc::now().timestamp() as u64,
        error: None,
    })
}

pub async fn delete_vault(_master_password: String, config: &SyncConfig) -> Result<bool, String> {
    let base_url = resolve_url(&config.railway_url);

    if config.vault_id.is_empty() {
        return Err("L'identificador de caixa forta no pot estar buit".to_string());
    }

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Error en crear client HTTP: {}", e))?;

    let response = client
        .delete(format!("{}/v1/vaults/{}", base_url, config.vault_id))
        .header("Authorization", format!("Bearer {}", config.token))
        .send()
        .await
        .map_err(|e| format!("Error en connectar amb Railway: {}", e))?;

    let status = response.status();
    match status {
        reqwest::StatusCode::NO_CONTENT => Ok(true),
        reqwest::StatusCode::NOT_FOUND => Ok(false),
        _ => {
            let body = response.text().await.unwrap_or_default();
            Err(format!("Error en eliminar caixa forta ({}): {}", status, body))
        }
    }
}

pub async fn check_health(railway_url: Option<&str>) -> Result<bool, String> {
    let base_url = resolve_url(railway_url.unwrap_or(DEFAULT_OFFICIAL_URL));

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Error en crear client HTTP: {}", e))?;

    let response = client
        .get(format!("{}/healthz", base_url))
        .send()
        .await
        .map_err(|e| format!("Error en connectar amb Railway ({}): {}", base_url, e))?;

    Ok(response.status().is_success())
}

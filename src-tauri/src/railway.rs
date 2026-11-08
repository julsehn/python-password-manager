use reqwest::Client;
use serde::{Deserialize, Serialize};

pub const DEFAULT_OFFICIAL_URL: &str = "https://password-manager-cloud-production.up.railway.app";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SyncConfig {
    pub railway_url: String,
    pub vault_id: String,
    pub token: String,
    #[serde(default)]
    pub refresh_token: String,
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
    pub refresh_token: String,
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
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
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

pub async fn revoke_refresh_token(config: &SyncConfig) -> Result<(), String> {
    if config.refresh_token.is_empty() {
        return Ok(());
    }
    let base_url = resolve_url(&config.railway_url);
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Error en crear client HTTP: {}", error))?;
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

pub async fn upload_vault(config: &SyncConfig) -> Result<SyncResponse, String> {
    let base_url = resolve_url(&config.railway_url);

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Error en crear client HTTP: {}", e))?;
    let access_token = get_access_token(&client, &base_url, config).await?;

    let vault_path = crate::vault_path();

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
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("Error en connectar amb Railway: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Error en pujar la caixa forta ({}) : {}",
            status, body
        ));
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

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Error en crear client HTTP: {}", e))?;
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

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Error en descarregar la caixa forta ({}): {}",
            status, body
        ));
    }

    let vault_response: VaultResponse = response
        .json()
        .await
        .map_err(|e| format!("Error en interpretar la resposta del servidor: {}", e))?;

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
        return Err(format!(
            "Error en registrar caixa forta ({}): {}",
            status, body
        ));
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
            Err(format!(
                "Error en eliminar caixa forta ({}): {}",
                status, body
            ))
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

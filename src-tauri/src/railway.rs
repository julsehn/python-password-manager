// Railway sync module for Tauri
// Uses reqwest HTTP client to interact with Railway FastAPI backend

use reqwest::Client;
use serde::{Deserialize, Serialize};

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

/// Upload vault to Railway
pub async fn upload_vault(
    _master_password: String,
    config: &SyncConfig,
) -> Result<SyncResponse, String> {
    println!("Uploading vault to Railway: {}", config.vault_id);

    // Validate configuration
    if config.railway_url.is_empty() {
        return Err("Railway URL is not configured".to_string());
    }
    if config.vault_id.is_empty() {
        return Err("Vault ID is not configured".to_string());
    }
    if config.token.is_empty() {
        return Err("Railway token is not configured".to_string());
    }

    // Create HTTP client
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // Get vault file path
    let home = std::env::var("HOME").ok();
    let vault_path = home
        .as_ref()
        .map(|h| format!("{}/.password_manager/vault.json", h))
        .unwrap_or_else(|| "./vault.json".to_string());

    // Check if vault file exists
    if !std::path::Path::new(&vault_path).exists() {
        return Err("Vault file not found. Create a vault first.".to_string());
    }

    // Read vault file
    let content = std::fs::read_to_string(&vault_path)
        .map_err(|e| format!("Failed to read vault file: {}", e))?;

    // Encrypt vault (placeholder - in production this would use the master password)
    // For now, we just pass the plaintext - this needs to be fixed
    let encrypted_blob = content.clone();

    // Prepare upload payload
    let payload = VaultBlob {
        blob: encrypted_blob,
        expected_version: None, // First upload, no version check
    };

    // Upload to Railway
    let response = client
        .put(format!("{}/v1/vaults/{}", config.railway_url, config.vault_id))
        .json(&payload)
        .header("Authorization", format!("Bearer {}", config.token))
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Upload failed (status {}): {}", status, body));
    }

    let vault_response: VaultResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(SyncResponse {
        success: true,
        message: format!("Vault uploaded successfully (version {})", vault_response.version),
        timestamp: chrono::Utc::now().timestamp() as u64,
        error: None,
    })
}

/// Download vault from Railway
pub async fn download_vault(
    _master_password: String,
    config: &SyncConfig,
) -> Result<String, String> {
    println!("Downloading vault from Railway: {}", config.vault_id);

    // Validate configuration
    if config.railway_url.is_empty() {
        return Err("Railway URL is not configured".to_string());
    }
    if config.vault_id.is_empty() {
        return Err("Vault ID is not configured".to_string());
    }
    if config.token.is_empty() {
        return Err("Railway token is not configured".to_string());
    }

    // Create HTTP client
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // Download vault from Railway
    let response = client
        .get(format!("{}/v1/vaults/{}", config.railway_url, config.vault_id))
        .header("Authorization", format!("Bearer {}", config.token))
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Download failed (status {}): {}", status, body));
    }

    let vault_response: VaultResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    // Save encrypted blob to vault file
    let home = std::env::var("HOME").ok();
    let vault_path = home
        .as_ref()
        .map(|h| format!("{}/.password_manager/vault.json", h))
        .unwrap_or_else(|| "./vault.json".to_string());

    // Save the blob as a temporary file for now
    // In production, this would decrypt the vault using master_password
    std::fs::write(&vault_path, vault_response.blob.clone())
        .map_err(|e| format!("Failed to write vault file: {}", e))?;

    Ok(vault_response.blob)
}

/// Register a new vault on Railway
pub async fn register_vault(
    _master_password: String,
    config: &SyncConfig,
) -> Result<SyncResponse, String> {
    println!("Registering new vault on Railway: {}", config.vault_id);

    // Validate configuration
    if config.railway_url.is_empty() {
        return Err("Railway URL is not configured".to_string());
    }
    if config.vault_id.is_empty() {
        return Err("Vault ID is not configured".to_string());
    }
    if config.token.is_empty() {
        return Err("Railway token is not configured".to_string());
    }

    // Create HTTP client
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // Prepare registration payload
    let payload = VaultRegistration {
        vault_id: config.vault_id.clone(),
        token: config.token.clone(),
        blob: String::new(), // Empty vault on first registration
    };

    // Register vault
    let response = client
        .post(format!("{}/v1/vaults", config.railway_url))
        .json(&payload)
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Registration failed (status {}): {}", status, body));
    }

    let vault_response: VaultResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(SyncResponse {
        success: true,
        message: format!("Vault registered successfully (version {})", vault_response.version),
        timestamp: chrono::Utc::now().timestamp() as u64,
        error: None,
    })
}

/// Delete vault from Railway
pub async fn delete_vault(
    _master_password: String,
    config: &SyncConfig,
) -> Result<bool, String> {
    println!("Deleting vault from Railway: {}", config.vault_id);

    // Validate configuration
    if config.railway_url.is_empty() {
        return Err("Railway URL is not configured".to_string());
    }
    if config.vault_id.is_empty() {
        return Err("Vault ID is not configured".to_string());
    }
    if config.token.is_empty() {
        return Err("Railway token is not configured".to_string());
    }

    // Create HTTP client
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // Delete vault
    let response = client
        .delete(format!("{}/v1/vaults/{}", config.railway_url, config.vault_id))
        .header("Authorization", format!("Bearer {}", config.token))
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    let status = response.status();
    match status {
        reqwest::StatusCode::NO_CONTENT => Ok(true),
        reqwest::StatusCode::NOT_FOUND => Ok(false),
        _ => {
            let body = response.text().await.unwrap_or_default();
            Err(format!("Delete failed (status {}): {}", status, body))
        }
    }
}

/// Check health of Railway backend
pub async fn check_health(railway_url: &str) -> Result<bool, String> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(format!("{}/healthz", railway_url))
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    Ok(response.status().is_success())
}

/// Auth functions for official cloud

#[derive(Debug, Serialize, Deserialize)]
struct UserAuthRequest {
    username: String,
    password: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct UserAuthResponse {
    user_id: i64,
    username: String,
    email: Option<String>,
    access_token: String,
    token_type: String,
}

/// Authenticate user with official cloud
pub async fn auth_user(username: &str, password: &str) -> Result<String, String> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let url = "https://password-manager-cloud-production.up.railway.app/v1/auth/login";
    
    let response = client
        .post(url)
        .json(&UserAuthRequest {
            username: username.to_string(),
            password: password.to_string(),
        })
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Authentication failed (status {}): {}", status, body));
    }

    let auth_response: UserAuthResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(auth_response.access_token)
}

/// Register new user with official cloud
pub async fn register_user(username: &str, password: &str) -> Result<bool, String> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let url = "https://password-manager-cloud-production.up.railway.app/v1/auth/register";
    
    let response = client
        .post(url)
        .json(&UserAuthRequest {
            username: username.to_string(),
            password: password.to_string(),
        })
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    match response.status() {
        reqwest::StatusCode::CREATED | reqwest::StatusCode::OK => Ok(true),
        reqwest::StatusCode::CONFLICT => {
            // User already exists
            println!("User {} already exists", username);
            Ok(false)
        }
        _ => {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            Err(format!("Registration failed (status {}): {}", status, body))
        }
    }
}

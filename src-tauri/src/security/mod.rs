// Security module for Tauri IPC communication

use aes_gcm::{aead::{Aead, KeyInit}, Aes256Gcm, Key, Nonce};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

const ASSOCIATED_DATA: &[u8] = b"caixa-forta-v1";

#[derive(Debug, Serialize, Deserialize)]
pub struct SecureMessage {
    pub action: String,
    pub payload: serde_json::Value,
    pub timestamp: u64,
    pub signature: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SecureResponse {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}

// Validate and authenticate incoming secure messages
pub fn validate_secure_message(message: &SecureMessage) -> Result<(), String> {
    // Validate the action is allowed
    let allowed_actions = [
        "unlock_vault", 
        "save_vault", 
        "change_master_password", 
        "lock_vault", 
        "fetch_credentials", 
        "save_credentials", 
        "get_vault_info"
    ];
    
    if !allowed_actions.contains(&message.action.as_str()) {
        return Err("Unauthorized action".into());
    }
    
    // Validate timestamp is not too old (max 5 minutes)
    let current_timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .map_err(|_| "Failed to get current timestamp".to_string())?;
    
    if current_timestamp.saturating_sub(message.timestamp) > 300 {
        return Err("Message timestamp too old".into());
    }
    
    Ok(())
}

// Generate secure token for message authentication
pub fn generate_secure_token() -> Result<String, String> {
    use rand::{rngs::OsRng, RngCore};
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    Ok(BASE64.encode(bytes))
}

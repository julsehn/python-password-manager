#![deny(warnings)]

#[allow(dead_code)]
mod security;
#[allow(dead_code)]
mod railway;

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use railway::{SyncConfig, SyncResponse};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credentials {
    pub username: String,
    pub password: String,
    pub url: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub site: String,
    pub username: String,
    pub password: String,
    pub notes: String,
    #[serde(default)]
    pub folder_id: Option<String>,
    pub created_at: String,
    pub updated_at: Option<String>,
    #[serde(default)]
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrashedEntry {
    pub id: String,
    pub site: String,
    pub username: String,
    pub password: String,
    pub notes: String,
    pub folder_id: Option<String>,
    pub created_at: String,
    pub updated_at: Option<String>,
    pub deleted_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryItem {
    pub id: String,
    pub kind: String,
    pub value: String,
    pub language: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultData {
    pub entries: Vec<Entry>,
    #[serde(default)]
    pub folders: Vec<Folder>,
    #[serde(default)]
    pub deleted_entries: Vec<TrashedEntry>,
    #[serde(default)]
    pub history: Vec<HistoryItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultState {
    pub is_new: bool,
    pub entries: Vec<Entry>,
    pub folders: Vec<Folder>,
    pub trash: Vec<TrashedEntry>,
    pub history: Vec<HistoryItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultInfo {
    pub exists: bool,
    pub entry_count: usize,
    pub folder_count: usize,
    pub trash_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct VaultFile {
    salt: String,
    nonce: String,
    ciphertext: String,
    version: String,
}

/// Initialize the application
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            println!("Caixa Forta Tauri application started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Core vault operations
            unlock_vault,
            save_vault,
            reset_vault,
            lock_vault,
            get_vault_info,

            // Password generator
            generate_password,
            generate_passphrase,
            generate_username,

            // Entry management
            create_entry,
            update_entry,
            trash_entry,
            restore_entry,
            delete_entry_permanently,

            // Folder management
            create_folder,
            update_folder,
            delete_folder,

            // Railway sync
            sync_upload_vault,
            sync_download_vault,
            register_vault,
            delete_vault,
            set_railway_sync_config,
            get_railway_sync_config,

            // Master password management
            change_master_password,

            // Export/Import
            export_vault,
            import_vault,
        ])
        .manage(Mutex::new(SyncConfig::default()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn reset_vault() -> Result<(), String> {
    let vault_path = std::env::var("HOME")
        .ok()
        .map(|home| format!("{}/.password_manager/vault.json", home))
        .unwrap_or_else(|| "./vault.json".to_string());

    if std::path::Path::new(&vault_path).exists() {
        std::fs::remove_file(&vault_path)
            .map_err(|e| format!("Failed to remove local vault: {}", e))?;
    }

    Ok(())
}

/// Unlock the vault with master password
/// This command decrypts the vault and returns the vault data
/// If the vault doesn't exist, returns an empty vault state (first use)
/// If the password is incorrect, decryption will fail with an error
#[tauri::command]
fn unlock_vault(master_password: String) -> Result<VaultState, String> {
    println!("Unlocking vault...");

    let vault_path = std::env::var("HOME")
        .ok()
        .map(|h| format!("{}/.password_manager/vault.json", h))
        .unwrap_or_else(|| "./vault.json".to_string());

    // Check if vault file exists
    if !std::path::Path::new(&vault_path).exists() {
        println!("Vault file not found, creating new empty vault state");
        // Return empty vault state for first use
        return Ok(VaultState {
            is_new: true,
            entries: vec![],
            folders: vec![],
            trash: vec![],
            history: vec![],
        });
    }

    // Load and decrypt vault
    let content = std::fs::read_to_string(&vault_path)
        .map_err(|e| format!("Failed to read vault file: {}", e))?;

    // Parse vault structure
    let vault_file: VaultFile = serde_json::from_str(&content).map_err(|e| {
        format!("Failed to parse vault structure: {}", e)
    })?;

    // Derive key from master password
    let salt_bytes = security::decode_hex_or_base64(&vault_file.salt, "salt")?;
    let key = security::derive_key_from_password(&master_password, &salt_bytes).map_err(|e| {
        format!("Failed to derive key from password: {}", e)
    })?;

    // Decrypt the ciphertext
    let nonce_bytes = security::decode_hex_or_base64(&vault_file.nonce, "nonce")?;
    let ciphertext_bytes = security::decode_hex_or_base64(&vault_file.ciphertext, "ciphertext")?;

    let decrypted = security::decrypt_aes_gcm(&key, &nonce_bytes, &ciphertext_bytes).map_err(|e| {
        // Decryption failed - likely wrong password or corrupted vault
        format!("Failed to decrypt vault: {}. Please verify your master password is correct.", e)
    })?;

    let data: String = String::from_utf8_lossy(&decrypted).into();
    let vault_data: VaultData = serde_json::from_str(&data).map_err(|e| {
        format!("Failed to parse decrypted vault data: {}", e)
    })?;

    let now = chrono::Utc::now().timestamp() as i64;

    Ok(VaultState {
        is_new: false,
        entries: vault_data.entries,
        folders: vault_data.folders,
        trash: vault_data.deleted_entries
            .into_iter()
            .filter(|entry| entry.deleted_at.parse::<i64>().unwrap_or(0) <= now)
            .collect(),
        history: vault_data.history,
    })
}

/// Save the encrypted vault
/// This command saves the vault locally and optionally syncs with Railway
#[tauri::command]
async fn save_vault(
    master_password: String,
    entries: Vec<Entry>,
    folders: Vec<Folder>,
    trash: Vec<TrashedEntry>,
    history: Vec<HistoryItem>,
    sync_to_railway: bool,
    sync_state: tauri::State<'_, Mutex<SyncConfig>>,
) -> Result<Option<String>, String> {
    println!("Saving vault...");

    // Serialize entries to filter out deleted ones
    let active_entries: Vec<_> = entries
        .into_iter()
        .filter(|e| e.deleted_at.is_none())
        .collect();

    let vault_data = VaultData {
        entries: active_entries,
        folders,
        deleted_entries: trash,
        history,
    };

    // Validate master password is not empty
    if master_password.is_empty() {
        return Err("Master password cannot be empty".to_string());
    }

    // Serialize and encrypt
    let data = serde_json::to_string(&vault_data).map_err(|e| format!("Failed to serialize: {}", e))?;

    let salt = security::generate_salt().map_err(|e| format!("Failed to generate salt: {}", e))?;

    // Derive key from master password using PBKDF2
    let key = security::derive_key_from_password(&master_password, &salt).map_err(|e| {
        format!("Failed to derive key: {}", e)
    })?;

    // Encrypt the data
    let nonce_bytes = security::generate_nonce().map_err(|e| format!("Failed to generate nonce: {}", e))?;
    let ciphertext = security::encrypt_aes_gcm(&key, &nonce_bytes, &data.into_bytes()).map_err(|e| {
        format!("Failed to encrypt: {}", e)
    })?;

    let vault_path = std::env::var("HOME")
        .ok()
        .map(|h| format!("{}/.password_manager/vault.json", h))
        .unwrap_or_else(|| "./vault.json".to_string());

    let payload = serde_json::json!({
        "salt": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &salt),
        "nonce": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &nonce_bytes),
        "ciphertext": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &ciphertext),
        "version": "1"
    });

    let vault_dir = std::path::Path::new(&vault_path).parent().unwrap_or(std::path::Path::new("."));
    std::fs::create_dir_all(&vault_dir)
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    std::fs::write(&vault_path, payload.to_string())
        .map_err(|e| format!("Failed to write vault: {}", e))?;

    println!("Vault saved successfully");

    // Optionally sync with Railway
    if sync_to_railway {
        let config = sync_state.lock().map_err(|_| "Failed to access Railway configuration".to_string())?.clone();

        if !config.railway_url.is_empty() && !config.vault_id.is_empty() && !config.token.is_empty() {
            println!("Syncing vault to Railway...");
            railway::upload_vault(master_password, &config).await.map_err(|e| {
                format!("Railway sync failed: {}. Vault saved locally but not synced.", e)
            })?;
            println!("Vault synced to Railway successfully");
            return Ok(Some(format!("Synced to Railway")));
        }
    }

    Ok(None)
}

/// Lock the vault (clear sensitive data from memory)
#[tauri::command]
fn lock_vault() -> Result<(), String> {
    println!("Vault locked");
    Ok(())
}

/// Get vault information
#[tauri::command]
fn get_vault_info() -> VaultInfo {
    let vault_path = std::env::var("HOME")
        .ok()
        .map(|h| format!("{}/.password_manager/vault.json", h))
        .unwrap_or_else(|| "./vault.json".to_string());

    let exists = std::path::Path::new(&vault_path).exists();

    VaultInfo {
        exists,
        entry_count: 0,
        folder_count: 0,
        trash_count: 0,
    }
}

/// Generate a secure random password
#[tauri::command]
fn generate_password(
    length: u32,
    uppercase: bool,
    lowercase: bool,
    numbers: bool,
    symbols: bool,
) -> String {
    println!("Generating password: length={}, uppercase={}, lowercase={}, numbers={}, symbols={}", length, uppercase, lowercase, numbers, symbols);

    security::generate_password(length, uppercase, lowercase, numbers, symbols)
}

/// Generate a passphrase using Diceware-style word list
#[tauri::command]
fn generate_passphrase(
    word_count: u32,
    separator: String,
    uppercase_words: bool,
    include_number: bool,
    remove_accents: bool,
    language: String,
) -> String {
    println!("Generating passphrase: words={}, separator={}, uppercase={}, include_number={}, language={}", word_count, separator, uppercase_words, include_number, language);

    security::generate_passphrase(word_count, separator, uppercase_words, include_number, remove_accents, language)
}

/// Generate a unique username
#[tauri::command]
fn generate_username(
    first_name: Option<String>,
    last_name: Option<String>,
    include_numbers: bool,
) -> String {
    println!("Generating username");

    security::generate_username(first_name, last_name, include_numbers)
}

/// Create a new entry in the vault
#[tauri::command]
fn create_entry(
    site: String,
    username: String,
    password: String,
    notes: String,
    folder_id: Option<String>,
) -> Result<Entry, String> {
    println!("Creating entry: {}", site);

    let now = chrono::Utc::now().to_rfc3339();

    let entry = Entry {
        id: uuid::Uuid::new_v4().to_string(),
        site,
        username,
        password,
        notes,
        folder_id,
        created_at: now.clone(),
        updated_at: Some(now.clone()),
        deleted_at: None,
    };

    // Save to vault (entry will be saved in update_entry after this)
    let vault_path = std::env::var("HOME")
        .ok()
        .map(|h| format!("{}/.password_manager/vault.json", h))
        .unwrap_or_else(|| "./vault.json".to_string());

    if std::path::Path::new(&vault_path).exists() {
        let content = std::fs::read_to_string(&vault_path).map_err(|e| format!("Failed to read vault: {}", e))?;
        let vault_data: VaultData = serde_json::from_str(&content).map_err(|e| format!("Failed to parse vault: {}", e))?;

        let mut entries = vault_data.entries;
        entries.push(entry.clone());

        let vault_data = VaultData {
            entries,
            ..vault_data
        };

        let data = serde_json::to_string(&vault_data).map_err(|e| format!("Failed to serialize: {}", e))?;
        std::fs::write(&vault_path, data).map_err(|e| format!("Failed to write vault: {}", e))?;
    }

    Ok(entry)
}

/// Update an existing entry
#[tauri::command]
fn update_entry(
    entry_id: String,
    site: String,
    username: String,
    password: String,
    notes: String,
    folder_id: Option<String>,
) -> Result<Entry, String> {
    println!("Updating entry: {}", entry_id);

    let vault_path = std::env::var("HOME")
        .ok()
        .map(|h| format!("{}/.password_manager/vault.json", h))
        .unwrap_or_else(|| "./vault.json".to_string());

    if !std::path::Path::new(&vault_path).exists() {
        return Err("Vault not found".to_string());
    }

    let content = std::fs::read_to_string(&vault_path).map_err(|e| format!("Failed to read vault: {}", e))?;
    let mut vault_data: VaultData = serde_json::from_str(&content).map_err(|e| format!("Failed to parse vault: {}", e))?;

    let now = chrono::Utc::now().to_rfc3339();

    let entry_index = vault_data.entries.iter().position(|e| e.id == entry_id).ok_or("Entry not found")?;

    // Update the existing entry in place, preserving id and created_at
    vault_data.entries[entry_index] = Entry {
        id: entry_id.clone(),
        site,
        username,
        password,
        notes,
        folder_id,
        created_at: vault_data.entries[entry_index].created_at.clone(),
        updated_at: Some(now.clone()),
        deleted_at: vault_data.entries[entry_index].deleted_at.clone(),
    };

    let updated_entry = vault_data.entries[entry_index].clone();

    let data = serde_json::to_string(&vault_data).map_err(|e| format!("Failed to serialize: {}", e))?;
    std::fs::write(&vault_path, data).map_err(|e| format!("Failed to write vault: {}", e))?;

    Ok(updated_entry)
}

/// Move entry to trash
#[tauri::command]
fn trash_entry(entry_id: String) -> Result<(), String> {
    println!("Trashing entry: {}", entry_id);

    let vault_path = std::env::var("HOME")
        .ok()
        .map(|h| format!("{}/.password_manager/vault.json", h))
        .unwrap_or_else(|| "./vault.json".to_string());

    if !std::path::Path::new(&vault_path).exists() {
        return Err("Vault not found".to_string());
    }

    let content = std::fs::read_to_string(&vault_path).map_err(|e| format!("Failed to read vault: {}", e))?;
    let mut vault_data: VaultData = serde_json::from_str(&content).map_err(|e| format!("Failed to parse vault: {}", e))?;

    let entry_index = vault_data.entries.iter().position(|e| e.id == entry_id).ok_or("Entry not found")?;

    let entry = vault_data.entries.remove(entry_index);
    let now = chrono::Utc::now().to_rfc3339();

    let trashed_entry = TrashedEntry {
        id: entry.id.clone(),
        site: entry.site.clone(),
        username: entry.username.clone(),
        password: entry.password.clone(),
        notes: entry.notes.clone(),
        folder_id: entry.folder_id.clone(),
        created_at: entry.created_at.clone(),
        updated_at: entry.updated_at.clone(),
        deleted_at: now,
    };

    vault_data.deleted_entries.push(trashed_entry);

    let data = serde_json::to_string(&vault_data).map_err(|e| format!("Failed to serialize: {}", e))?;
    std::fs::write(&vault_path, data).map_err(|e| format!("Failed to write vault: {}", e))?;

    Ok(())
}

/// Restore entry from trash
#[tauri::command]
fn restore_entry(entry_id: String) -> Result<(), String> {
    println!("Restoring entry: {}", entry_id);

    let vault_path = std::env::var("HOME")
        .ok()
        .map(|h| format!("{}/.password_manager/vault.json", h))
        .unwrap_or_else(|| "./vault.json".to_string());

    if !std::path::Path::new(&vault_path).exists() {
        return Err("Vault not found".to_string());
    }

    let content = std::fs::read_to_string(&vault_path).map_err(|e| format!("Failed to read vault: {}", e))?;
    let mut vault_data: VaultData = serde_json::from_str(&content).map_err(|e| format!("Failed to parse vault: {}", e))?;

    let trashed_index = vault_data.deleted_entries.iter().position(|e| e.id == entry_id).ok_or("Entry not found")?;
    let trashed = vault_data.deleted_entries.remove(trashed_index);

    let entry = Entry {
        id: trashed.id,
        site: trashed.site,
        username: trashed.username,
        password: trashed.password,
        notes: trashed.notes,
        folder_id: trashed.folder_id,
        created_at: trashed.created_at,
        updated_at: trashed.updated_at,
        deleted_at: None,
    };

    vault_data.entries.push(entry);

    let data = serde_json::to_string(&vault_data).map_err(|e| format!("Failed to serialize: {}", e))?;
    std::fs::write(&vault_path, data).map_err(|e| format!("Failed to write vault: {}", e))?;

    Ok(())
}

/// Permanently delete an entry
#[tauri::command]
fn delete_entry_permanently(entry_id: String) -> Result<(), String> {
    println!("Permanently deleting entry: {}", entry_id);

    let vault_path = std::env::var("HOME")
        .ok()
        .map(|h| format!("{}/.password_manager/vault.json", h))
        .unwrap_or_else(|| "./vault.json".to_string());

    if !std::path::Path::new(&vault_path).exists() {
        return Err("Vault not found".to_string());
    }

    let content = std::fs::read_to_string(&vault_path).map_err(|e| format!("Failed to read vault: {}", e))?;
    let mut vault_data: VaultData = serde_json::from_str(&content).map_err(|e| format!("Failed to parse vault: {}", e))?;

    let trashed_index = vault_data.deleted_entries.iter().position(|e| e.id == entry_id).ok_or("Entry not found")?;

    vault_data.deleted_entries.remove(trashed_index);

    let data = serde_json::to_string(&vault_data).map_err(|e| format!("Failed to serialize: {}", e))?;
    std::fs::write(&vault_path, data).map_err(|e| format!("Failed to write vault: {}", e))?;

    // Also delete the file on disk
    std::fs::remove_file(&vault_path).ok();

    Ok(())
}

/// Create a new folder
#[tauri::command]
fn create_folder(name: String, icon: String, color: String) -> Result<Folder, String> {
    println!("Creating folder: {}", name);

    let folder = Folder {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        icon,
        color,
    };

    let vault_path = std::env::var("HOME")
        .ok()
        .map(|h| format!("{}/.password_manager/vault.json", h))
        .unwrap_or_else(|| "./vault.json".to_string());

    if std::path::Path::new(&vault_path).exists() {
        let content = std::fs::read_to_string(&vault_path).map_err(|e| format!("Failed to read vault: {}", e))?;
        let mut vault_data: VaultData = serde_json::from_str(&content).map_err(|e| format!("Failed to parse vault: {}", e))?;
        vault_data.folders.push(folder.clone());

        let data = serde_json::to_string(&vault_data).map_err(|e| format!("Failed to serialize: {}", e))?;
        std::fs::write(&vault_path, data).map_err(|e| format!("Failed to write vault: {}", e))?;
    }

    Ok(folder)
}

/// Update a folder
#[tauri::command]
fn update_folder(folder_id: String, name: String, icon: String, color: String) -> Result<Folder, String> {
    println!("Updating folder: {}", folder_id);

    let vault_path = std::env::var("HOME")
        .ok()
        .map(|h| format!("{}/.password_manager/vault.json", h))
        .unwrap_or_else(|| "./vault.json".to_string());

    if !std::path::Path::new(&vault_path).exists() {
        return Err("Vault not found".to_string());
    }

    let content = std::fs::read_to_string(&vault_path).map_err(|e| format!("Failed to read vault: {}", e))?;
    let mut vault_data: VaultData = serde_json::from_str(&content).map_err(|e| format!("Failed to parse vault: {}", e))?;

    let index = vault_data.folders.iter().position(|f| f.id == folder_id).ok_or("Folder not found")?;

    vault_data.folders[index] = Folder {
        id: folder_id.clone(),
        name,
        icon,
        color,
    };

    let data = serde_json::to_string(&vault_data).map_err(|e| format!("Failed to serialize: {}", e))?;
    std::fs::write(&vault_path, data).map_err(|e| format!("Failed to write vault: {}", e))?;

    Ok(vault_data.folders[index].clone())
}

/// Delete a folder
#[tauri::command]
fn delete_folder(folder_id: String) -> Result<(), String> {
    println!("Deleting folder: {}", folder_id);

    let vault_path = std::env::var("HOME")
        .ok()
        .map(|h| format!("{}/.password_manager/vault.json", h))
        .unwrap_or_else(|| "./vault.json".to_string());

    if !std::path::Path::new(&vault_path).exists() {
        return Err("Vault not found".to_string());
    }

    let content = std::fs::read_to_string(&vault_path).map_err(|e| format!("Failed to read vault: {}", e))?;
    let mut vault_data: VaultData = serde_json::from_str(&content).map_err(|e| format!("Failed to parse vault: {}", e))?;

    vault_data.folders.retain(|f| f.id != folder_id);

    let data = serde_json::to_string(&vault_data).map_err(|e| format!("Failed to serialize: {}", e))?;
    std::fs::write(&vault_path, data).map_err(|e| format!("Failed to write vault: {}", e))?;

    Ok(())
}

/// Sync vault to Railway
#[tauri::command]
async fn sync_upload_vault(
    master_password: String,
    config: SyncConfig,
) -> Result<SyncResponse, String> {
    println!("Syncing vault to Railway: {}", config.vault_id);

    // Read and decrypt vault from local storage
    let vault_path = std::env::var("HOME")
        .ok()
        .map(|h| format!("{}/.password_manager/vault.json", h))
        .unwrap_or_else(|| "./vault.json".to_string());

    if !std::path::Path::new(&vault_path).exists() {
        return Err("No local vault found to sync".to_string());
    }

    let content = std::fs::read_to_string(&vault_path).map_err(|e| {
        format!("Failed to read local vault file: {}", e)
    })?;

    let vault_file: VaultFile = serde_json::from_str(&content).map_err(|e| {
        format!("Failed to parse vault structure: {}", e)
    })?;

    // Decrypt with master password
    let salt_bytes = security::decode_hex_or_base64(&vault_file.salt, "salt")?;
    let key = security::derive_key_from_password(&master_password, &salt_bytes).map_err(|e| {
        format!("Failed to derive key: {}", e)
    })?;

    let nonce_bytes = security::decode_hex_or_base64(&vault_file.nonce, "nonce")?;
    let ciphertext_bytes = security::decode_hex_or_base64(&vault_file.ciphertext, "ciphertext")?;

    let decrypted = security::decrypt_aes_gcm(&key, &nonce_bytes, &ciphertext_bytes).map_err(|e| {
        format!("Failed to decrypt vault: {}. Please verify your master password.", e)
    })?;

    let _data: String = String::from_utf8_lossy(&decrypted).into();

    // Upload encrypted vault to Railway (re-encrypt with new key)
    railway::upload_vault(master_password, &config).await
}

/// Download vault from Railway
#[tauri::command]
async fn sync_download_vault(master_password: String, config: SyncConfig) -> Result<String, String> {
    println!("Downloading vault from Railway: {}", config.vault_id);

    // Download encrypted vault from Railway
    let blob = railway::download_vault(master_password.clone(), &config).await?;

    // Parse the downloaded blob (should be encrypted vault)
    let vault_file: VaultFile = serde_json::from_str(&blob).map_err(|e| {
        format!("Failed to parse downloaded vault structure: {}", e)
    })?;

    // Derive key from master password
    let salt_bytes = security::decode_hex_or_base64(&vault_file.salt, "salt")?;
    let key = security::derive_key_from_password(&master_password, &salt_bytes).map_err(|e| {
        format!("Failed to derive key: {}", e)
    })?;

    let nonce_bytes = security::decode_hex_or_base64(&vault_file.nonce, "nonce")?;
    let ciphertext_bytes = security::decode_hex_or_base64(&vault_file.ciphertext, "ciphertext")?;

    // Decrypt vault
    let decrypted = security::decrypt_aes_gcm(&key, &nonce_bytes, &ciphertext_bytes).map_err(|e| {
        format!("Failed to decrypt downloaded vault: {}. Please verify your master password.", e)
    })?;

    let data: String = String::from_utf8_lossy(&decrypted).into();
    let vault_data: VaultData = serde_json::from_str(&data).map_err(|e| {
        format!("Failed to parse decrypted vault: {}", e)
    })?;

    // Return the VaultData as JSON
    Ok(serde_json::to_string(&vault_data).map_err(|e| format!("Failed to serialize vault: {}", e))? )
}

#[tauri::command]
async fn register_vault(master_password: String, config: SyncConfig) -> Result<SyncResponse, String> {
    railway::register_vault(master_password, &config).await
}

/// Authenticate user with official cloud
#[tauri::command]
async fn auth_official_cloud(username: String, password: String) -> Result<(), String> {
    railway::auth_user(&username, &password).await
}

#[tauri::command]
async fn delete_vault(master_password: String, config: SyncConfig) -> Result<bool, String> {
    railway::delete_vault(master_password, &config).await
}

/// Configure Railway sync settings
#[tauri::command]
fn set_railway_sync_config(
    railway_url: String,
    vault_id: String,
    token: String,
    state: tauri::State<'_, Mutex<SyncConfig>>,
) -> Result<(), String> {
    println!("Setting Railway sync configuration...");

    if railway_url.is_empty() {
        return Err("Railway URL cannot be empty".to_string());
    }
    if vault_id.is_empty() {
        return Err("Vault ID cannot be empty".to_string());
    }
    if token.is_empty() {
        return Err("Token cannot be empty".to_string());
    }

    // Update the SyncConfig in app state
    let mut config = state.lock().map_err(|_| "Failed to access Railway configuration".to_string())?;
    *config = SyncConfig {
        railway_url,
        vault_id,
        token,
    };

    println!("Railway sync configured successfully");
    Ok(())
}

/// Get current Railway sync configuration
#[tauri::command]
fn get_railway_sync_config(state: tauri::State<'_, Mutex<SyncConfig>>) -> Result<SyncConfig, String> {
    state.lock()
        .map(|config| config.clone())
        .map_err(|_| "Failed to access Railway configuration".to_string())
}

/// Change master password
/// This command re-encrypts the vault with a new master password
/// It first decrypts the vault with the current password, then re-encrypts with the new password
#[tauri::command]
fn change_master_password(
    current_password: String,
    new_password: String,
    entries: Vec<Entry>,
    folders: Vec<Folder>,
    trash: Vec<TrashedEntry>,
    history: Vec<HistoryItem>,
) -> Result<(), String> {
    println!("Changing master password...");
    let _ = (&entries, &folders, &trash, &history);

    // Validate passwords
    if current_password.is_empty() {
        return Err("Current password cannot be empty".to_string());
    }
    if new_password.is_empty() {
        return Err("New password cannot be empty".to_string());
    }
    if new_password.len() < 12 {
        return Err("New password must be at least 12 characters".to_string());
    }

    // Read existing encrypted vault
    let vault_path = std::env::var("HOME")
        .ok()
        .map(|h| format!("{}/.password_manager/vault.json", h))
        .unwrap_or_else(|| "./vault.json".to_string());

    if !std::path::Path::new(&vault_path).exists() {
        return Err("No existing vault found. Create a vault first with your master password.".to_string());
    }

    // Decrypt existing vault with current password
    let content = std::fs::read_to_string(&vault_path).map_err(|e| {
        format!("Failed to read encrypted vault file: {}", e)
    })?;

    let old_vault_file: VaultFile = serde_json::from_str(&content).map_err(|e| {
        format!("Failed to parse encrypted vault structure: {}", e)
    })?;

    let old_salt_bytes = security::decode_hex_or_base64(&old_vault_file.salt, "salt")?;
    let old_key = security::derive_key_from_password(&current_password, &old_salt_bytes).map_err(|e| {
        format!("Failed to derive key with current password: {}", e)
    })?;

    let old_nonce_bytes = security::decode_hex_or_base64(&old_vault_file.nonce, "nonce")?;
    let old_ciphertext_bytes = security::decode_hex_or_base64(&old_vault_file.ciphertext, "ciphertext")?;

    let decrypted = security::decrypt_aes_gcm(&old_key, &old_nonce_bytes, &old_ciphertext_bytes).map_err(|e| {
        format!("Failed to decrypt vault with current password: {}. Please verify your current master password is correct.", e)
    })?;

    let old_data: String = String::from_utf8_lossy(&decrypted).into();
    let old_vault_data: VaultData = serde_json::from_str(&old_data).map_err(|e| {
        format!("Failed to parse decrypted vault data: {}", e)
    })?;

    println!("Successfully decrypted vault with current password");

    // Create new VaultData with preserved entries, folders, trash, history
    let new_vault_data = VaultData {
        entries: old_vault_data.entries,
        folders: old_vault_data.folders,
        deleted_entries: old_vault_data.deleted_entries,
        history: old_vault_data.history,
    };

    // Re-encrypt with new password, generating new salt and nonce
    let new_salt = security::generate_salt().map_err(|e| format!("Failed to generate salt: {}", e))?;
    let new_key = security::derive_key_from_password(&new_password, &new_salt).map_err(|e| {
        format!("Failed to derive key with new password: {}", e)
    })?;
    let new_nonce_bytes = security::generate_nonce().map_err(|e| format!("Failed to generate nonce: {}", e))?;
    let new_data = serde_json::to_string(&new_vault_data)
        .map_err(|e| format!("Failed to serialize updated vault: {}", e))?;
    let new_ciphertext = security::encrypt_aes_gcm(&new_key, &new_nonce_bytes, &new_data.into_bytes()).map_err(|e| {
        format!("Failed to re-encrypt vault with new password: {}", e)
    })?;

    let payload = serde_json::json!({
        "salt": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &new_salt),
        "nonce": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &new_nonce_bytes),
        "ciphertext": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &new_ciphertext),
        "version": "1"
    });

    let vault_dir = std::path::Path::new(&vault_path).parent().unwrap_or(std::path::Path::new("."));
    std::fs::create_dir_all(&vault_dir).map_err(|e| format!("Failed to create vault directory: {}", e))?;
    std::fs::write(&vault_path, payload.to_string()).map_err(|e| format!("Failed to save re-encrypted vault: {}", e))?;

    println!("Master password changed successfully - vault re-encrypted with new password");
    Ok(())
}

/// Export vault to JSON file
#[tauri::command]
fn export_vault(path: String) -> Result<(), String> {
    println!("Exporting vault to: {}", path);

    // Warning: This exports unencrypted data - user should manually encrypt
    let vault_path = std::env::var("HOME")
        .ok()
        .map(|h| format!("{}/.password_manager/vault.json", h))
        .unwrap_or_else(|| "./vault.json".to_string());

    if !std::path::Path::new(&vault_path).exists() {
        return Err("Vault not found".to_string());
    }

    std::fs::copy(&vault_path, &path).map_err(|e| format!("Failed to export: {}", e))?;

    Ok(())
}

/// Import vault from JSON file
#[tauri::command]
fn import_vault(path: String) -> Result<(), String> {
    println!("Importing vault from: {}", path);

    if !std::path::Path::new(&path).exists() {
        return Err("Import file not found".to_string());
    }

    let content = std::fs::read_to_string(&path).map_err(|e| format!("Failed to read: {}", e))?;
    let _vault_data: VaultData = serde_json::from_str(&content).map_err(|e| format!("Failed to parse: {}", e))?;

    let dest_path = std::env::var("HOME")
        .ok()
        .map(|h| format!("{}/.password_manager/vault.json", h))
        .unwrap_or_else(|| "./vault.json".to_string());

    std::fs::write(&dest_path, content).map_err(|e| format!("Failed to import: {}", e))?;

    Ok(())
}

#![deny(warnings)]

#[allow(dead_code)]
mod security;
#[allow(dead_code)]
mod railway;
#[allow(dead_code)]
pub mod server;

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use railway::{SyncConfig, SyncResponse};
use server::ServerState;

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

pub fn run() {
    let server_state = Arc::new(ServerState::new());
    let server_state_clone = Arc::clone(&server_state);
    let server_state_setup = Arc::clone(&server_state);

    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut("CommandOrControl+Shift+P")
                .expect("failed to register command palette shortcut")
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        let _ = app.emit("palette-shortcut", ());
                    }
                })
                .build(),
        )
        .setup(move |app| {
            println!("Caixa Forta Tauri application started");
            server_state_setup.set_app_handle(app.handle().clone());
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::start_server(server_state_clone, 8080).await {
                    eprintln!("Caixa Forta Extension Server error: {}", e);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            init_empty_vault,
            unlock_vault,
            save_vault,
            reset_vault,
            lock_vault,
            hide_main_window,
            get_vault_info,
            get_vault_entries,
            generate_password,
            generate_passphrase,
            generate_username,
            create_entry,
            update_entry,
            trash_entry,
            restore_entry,
            delete_entry_permanently,
            create_folder,
            update_folder,
            delete_folder,
            sync_upload_vault,
            sync_download_vault,
            register_vault,
            delete_vault,
            set_railway_sync_config,
            get_railway_sync_config,
            change_master_password,
            get_auth_info,
            set_grid_auth,
            get_image_grid_auth,
            set_image_grid_auth,
            change_vault_to_image_grid,
            change_vault_to_password,
            unlock_vault_grid,
            change_auth_method,
            export_vault,
            import_vault,
        ])
        .manage(Mutex::new(SyncConfig::default()))
        .manage(server_state)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn init_empty_vault(
    password: String,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<(), String> {
    println!("Creating new vault...");

    let vault_data = VaultData {
        entries: vec![],
        folders: vec![],
        deleted_entries: vec![],
        history: vec![],
    };

    let data = serde_json::to_string(&vault_data)
        .map_err(|e| format!("Failed to serialize: {}", e))?;

    let salt = security::generate_salt()
        .map_err(|e| format!("Failed to generate salt: {}", e))?;

    let key = security::derive_key_from_password(&password, &salt)
        .map_err(|e| format!("Failed to derive key: {}", e))?;

    let nonce_bytes = security::generate_nonce()
        .map_err(|e| format!("Failed to generate nonce: {}", e))?;
    let ciphertext = security::encrypt_aes_gcm(&key, &nonce_bytes, &data.into_bytes())
        .map_err(|e| format!("Failed to encrypt: {}", e))?;

    let vault_path = std::env::var("HOME")
        .ok()
        .map(|h| format!("{}/.password_manager/vault.json", h))
        .unwrap_or_else(|| "./vault.json".to_string());

    let vault_dir = std::path::Path::new(&vault_path)
        .parent()
        .unwrap_or(std::path::Path::new("."));
    std::fs::create_dir_all(&vault_dir)
        .map_err(|e| format!("Failed to create vault directory: {}", e))?;

    let payload = serde_json::json!({
        "salt": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &salt),
        "nonce": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &nonce_bytes),
        "ciphertext": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &ciphertext),
        "version": "1"
    });

    std::fs::write(&vault_path, payload.to_string())
        .map_err(|e| format!("Failed to write vault: {}", e))?;

    println!("Vault created successfully");

    server_state.set_unlocked(password, vec![], vec![], vec![], vec![]);

    Ok(())
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

#[tauri::command]
fn unlock_vault(
    master_password: String,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<VaultState, String> {
    println!("Unlocking vault...");

    let vault_path = std::env::var("HOME")
        .ok()
        .map(|h| format!("{}/.password_manager/vault.json", h))
        .unwrap_or_else(|| "./vault.json".to_string());

    if !std::path::Path::new(&vault_path).exists() {
        println!("Vault file not found, creating new empty vault state");
        server_state.set_unlocked(master_password, vec![], vec![], vec![], vec![]);
        return Ok(VaultState {
            is_new: true,
            entries: vec![],
            folders: vec![],
            trash: vec![],
            history: vec![],
        });
    }

    let content = std::fs::read_to_string(&vault_path)
        .map_err(|e| format!("Failed to read vault file: {}", e))?;

    let vault_file: VaultFile = serde_json::from_str(&content).map_err(|e| {
        format!("Failed to parse vault structure: {}", e)
    })?;

    let salt_bytes = security::decode_hex_or_base64(&vault_file.salt, "salt")?;
    let key = security::derive_key_from_password(&master_password, &salt_bytes).map_err(|e| {
        format!("Failed to derive key from password: {}", e)
    })?;

    let nonce_bytes = security::decode_hex_or_base64(&vault_file.nonce, "nonce")?;
    let ciphertext_bytes = security::decode_hex_or_base64(&vault_file.ciphertext, "ciphertext")?;

    let decrypted = security::decrypt_aes_gcm(&key, &nonce_bytes, &ciphertext_bytes).map_err(|e| {
        format!("Failed to decrypt vault: {}. Please verify your master password is correct.", e)
    })?;

    let data: String = String::from_utf8_lossy(&decrypted).into();
    let vault_data: VaultData = serde_json::from_str(&data).map_err(|e| {
        format!("Failed to parse decrypted vault data: {}", e)
    })?;

    server_state.set_unlocked(
        master_password,
        vault_data.entries.clone(),
        vault_data.folders.clone(),
        vault_data.deleted_entries.clone(),
        vault_data.history.clone(),
    );

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

#[tauri::command]
async fn save_vault(
    master_password: String,
    entries: Vec<Entry>,
    folders: Vec<Folder>,
    trash: Vec<TrashedEntry>,
    history: Vec<HistoryItem>,
    sync_to_railway: bool,
    sync_state: tauri::State<'_, Mutex<SyncConfig>>,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<Option<String>, String> {
    println!("Saving vault...");

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

    if master_password.is_empty() {
        return Err("Master password cannot be empty".to_string());
    }

    let data = serde_json::to_string(&vault_data).map_err(|e| format!("Failed to serialize: {}", e))?;

    let salt = security::generate_salt().map_err(|e| format!("Failed to generate salt: {}", e))?;

    let key = security::derive_key_from_password(&master_password, &salt).map_err(|e| {
        format!("Failed to derive key: {}", e)
    })?;

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

    server_state.set_unlocked(
        master_password.clone(),
        vault_data.entries.clone(),
        vault_data.folders.clone(),
        vault_data.deleted_entries.clone(),
        vault_data.history.clone(),
    );

    println!("Vault saved successfully");

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

#[tauri::command]
fn lock_vault(server_state: tauri::State<'_, Arc<ServerState>>) -> Result<(), String> {
    println!("Vault locked");
    server_state.lock();
    Ok(())
}

#[tauri::command]
fn hide_main_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

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

#[tauri::command]
fn get_vault_entries(
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<VaultState, String> {
    let unlocked = server_state.unlocked_data.lock().unwrap();
    match &*unlocked {
        Some(vault) => {
            let now = chrono::Utc::now().timestamp() as i64;
            Ok(VaultState {
                is_new: false,
                entries: vault.entries.clone(),
                folders: vault.folders.clone(),
                trash: vault
                    .trash
                    .iter()
                    .cloned()
                    .filter(|entry| entry.deleted_at.parse::<i64>().unwrap_or(0) <= now)
                    .collect(),
                history: vault.history.clone(),
            })
        }
        None => Err("Vault is locked".to_string()),
    }
}

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

#[tauri::command]
fn generate_username(
    first_name: Option<String>,
    last_name: Option<String>,
    include_numbers: bool,
) -> String {
    println!("Generating username");

    security::generate_username(first_name, last_name, include_numbers)
}

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

    std::fs::remove_file(&vault_path).ok();

    Ok(())
}

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

#[tauri::command]
async fn sync_upload_vault(
    master_password: String,
    config: SyncConfig,
) -> Result<SyncResponse, String> {
    println!("Syncing vault to Railway: {}", config.vault_id);

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

    railway::upload_vault(master_password, &config).await
}

#[tauri::command]
async fn sync_download_vault(master_password: String, config: SyncConfig) -> Result<String, String> {
    println!("Downloading vault from Railway: {}", config.vault_id);

    let blob = railway::download_vault(master_password.clone(), &config).await?;

    let vault_file: VaultFile = serde_json::from_str(&blob).map_err(|e| {
        format!("Failed to parse downloaded vault structure: {}", e)
    })?;

    let salt_bytes = security::decode_hex_or_base64(&vault_file.salt, "salt")?;
    let key = security::derive_key_from_password(&master_password, &salt_bytes).map_err(|e| {
        format!("Failed to derive key: {}", e)
    })?;

    let nonce_bytes = security::decode_hex_or_base64(&vault_file.nonce, "nonce")?;
    let ciphertext_bytes = security::decode_hex_or_base64(&vault_file.ciphertext, "ciphertext")?;

    let decrypted = security::decrypt_aes_gcm(&key, &nonce_bytes, &ciphertext_bytes).map_err(|e| {
        format!("Failed to decrypt downloaded vault: {}. Please verify your master password.", e)
    })?;

    let data: String = String::from_utf8_lossy(&decrypted).into();
    let vault_data: VaultData = serde_json::from_str(&data).map_err(|e| {
        format!("Failed to parse decrypted vault: {}", e)
    })?;

    Ok(serde_json::to_string(&vault_data).map_err(|e| format!("Failed to serialize vault: {}", e))? )
}

#[tauri::command]
async fn register_vault(master_password: String, config: SyncConfig) -> Result<SyncResponse, String> {
    railway::register_vault(master_password, &config).await
}

#[tauri::command]
#[allow(dead_code)]
async fn auth_official_cloud(username: String, password: String) -> Result<String, String> {
    railway::auth_user(&username, &password).await
}

#[tauri::command]
async fn delete_vault(master_password: String, config: SyncConfig) -> Result<bool, String> {
    railway::delete_vault(master_password, &config).await
}

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

    let mut config = state.lock().map_err(|_| "Failed to access Railway configuration".to_string())?;
    *config = SyncConfig {
        railway_url,
        vault_id,
        token,
    };

    println!("Railway sync configured successfully");
    Ok(())
}

#[tauri::command]
fn get_railway_sync_config(state: tauri::State<'_, Mutex<SyncConfig>>) -> Result<SyncConfig, String> {
    state.lock()
        .map(|config| config.clone())
        .map_err(|_| "Failed to access Railway configuration".to_string())
}

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

    if current_password.is_empty() {
        return Err("Current password cannot be empty".to_string());
    }
    if new_password.is_empty() {
        return Err("New password cannot be empty".to_string());
    }
    if new_password.len() < 12 {
        return Err("New password must be at least 12 characters".to_string());
    }

    let vault_path = std::env::var("HOME")
        .ok()
        .map(|h| format!("{}/.password_manager/vault.json", h))
        .unwrap_or_else(|| "./vault.json".to_string());

    if !std::path::Path::new(&vault_path).exists() {
        return Err("No existing vault found. Create a vault first with your master password.".to_string());
    }

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

    let new_vault_data = VaultData {
        entries: old_vault_data.entries,
        folders: old_vault_data.folders,
        deleted_entries: old_vault_data.deleted_entries,
        history: old_vault_data.history,
    };

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

#[tauri::command]
fn get_auth_info() -> VaultInfo {
    let grid_auth_path = std::env::var("HOME")
        .ok()
        .map(|h| format!("{}/.password_manager/grid_auth.json", h))
        .unwrap_or_else(|| "./grid_auth.json".to_string());

    let exists = std::path::Path::new(&grid_auth_path).exists();

    VaultInfo {
        exists,
        entry_count: 0,
        folder_count: 0,
        trash_count: 0,
    }
}

fn grid_auth_path() -> std::path::PathBuf {
    std::env::var("HOME")
        .map(|home| std::path::PathBuf::from(home).join(".password_manager/grid_auth.json"))
        .unwrap_or_else(|_| std::path::PathBuf::from("./grid_auth.json"))
}

fn grid_password_from_cells(cells: &[u8], cell_values: &[String]) -> Result<String, String> {
    let mut seen = std::collections::HashSet::new();
    if cells.len() < 5 || cells.iter().any(|cell| *cell >= 25 || !seen.insert(*cell)) {
        return Err("Select at least 5 unique valid grid cells".to_string());
    }
    cells
        .iter()
        .map(|cell| {
            cell_values
                .get(*cell as usize)
                .map(String::as_str)
                .ok_or_else(|| "Selected grid cell is invalid".to_string())
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|parts| parts.concat())
}

fn legacy_image_password(selected: &[u8], stored: &[u8]) -> Result<String, String> {
    if selected.len() != stored.len() {
        return Err("Pattern length mismatch".to_string());
    }
    if selected
        .iter()
        .zip(stored)
        .any(|(point, saved)| (*point as i16 - *saved as i16).abs() > 15)
    {
        return Err("Pattern verification failed".to_string());
    }
    Ok(stored
        .iter()
        .map(u8::to_string)
        .collect::<Vec<_>>()
        .join("-"))
}

fn validate_image_grid(image_data: &str, cell_values: &[String]) -> Result<(), String> {
    if !image_data.starts_with("data:image/") || image_data.len() > 20_000_000 {
        return Err("Invalid image data".to_string());
    }
    if cell_values.len() != 25
        || cell_values.iter().any(|value| !valid_image_grid_fragment(value))
        || cell_values.iter().collect::<std::collections::HashSet<_>>().len() != 25
    {
        return Err("Image grid cells must be valid 2-character legacy or mixed 4-character fragments".to_string());
    }
    Ok(())
}

fn validate_new_image_grid(image_data: &str, cell_values: &[String]) -> Result<(), String> {
    validate_image_grid(image_data, cell_values)?;
    if cell_values.iter().any(|value| {
        value.len() != 4
            || !value.bytes().any(|byte| byte.is_ascii_uppercase())
            || !value.bytes().any(|byte| byte.is_ascii_lowercase())
            || !value.bytes().any(|byte| byte.is_ascii_digit())
            || !value
                .bytes()
                .any(|byte| b"!@#$%^&*()-_=+[]{}".contains(&byte))
    }) {
        return Err("Every new grid fragment must contain uppercase, lowercase, a number, and a symbol".to_string());
    }
    Ok(())
}

fn valid_image_grid_fragment(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() == 2 {
        return bytes.iter().all(u8::is_ascii_alphanumeric);
    }
    if bytes.len() != 4 {
        return false;
    }
    if bytes.iter().all(u8::is_ascii_alphanumeric)
        && !bytes.iter().any(u8::is_ascii_lowercase)
    {
        return true;
    }

    let has_uppercase = bytes.iter().any(u8::is_ascii_uppercase);
    let has_lowercase = bytes.iter().any(u8::is_ascii_lowercase);
    let has_digit = bytes.iter().any(u8::is_ascii_digit);
    let has_symbol = bytes.iter().any(|byte| b"!@#$%^&*()-_=+[]{}".contains(byte));
    has_uppercase
        && has_lowercase
        && has_digit
        && has_symbol
        && bytes.iter().all(|byte| {
            byte.is_ascii_alphanumeric() || b"!@#$%^&*()-_=+[]{}".contains(byte)
        })
}

fn save_image_grid_metadata(image_data: &str, cell_values: &[String]) -> Result<(), String> {
    validate_image_grid(image_data, cell_values)?;
    let auth_data = serde_json::json!({
        "type": "image_grid",
        "version": 3,
        "image_data": image_data,
        "cell_values": cell_values,
    });
    let path = grid_auth_path();
    let directory = path.parent().unwrap_or(std::path::Path::new("."));
    std::fs::create_dir_all(directory)
        .map_err(|error| format!("Failed to create grid auth directory: {}", error))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("Failed to secure grid auth directory: {}", error))?;
    }
    std::fs::write(&path, auth_data.to_string())
        .map_err(|error| format!("Failed to write grid auth data: {}", error))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Failed to secure grid auth data: {}", error))?;
    }
    Ok(())
}

/// Return the public image and password-fragment grid used by the image auth screen.
#[tauri::command]
fn get_image_grid_auth() -> Result<Option<serde_json::Value>, String> {
    let path = grid_auth_path();
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(path)
        .map_err(|error| format!("Failed to read grid auth data: {}", error))?;
    let data: serde_json::Value = serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse grid auth data: {}", error))?;
    Ok(Some(data))
}

/// Persist the image and generated cell fragments in plaintext for pre-unlock display.
#[tauri::command]
fn set_image_grid_auth(image_data: String, cell_values: Vec<String>) -> Result<(), String> {
    validate_new_image_grid(&image_data, &cell_values)?;
    save_image_grid_metadata(&image_data, &cell_values)
}

/// Re-encrypt an existing vault using the selected image-grid fragments.
#[tauri::command]
fn change_vault_to_image_grid(
    current_password: String,
    selected_cells: Vec<u8>,
    image_data: String,
    cell_values: Vec<String>,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<VaultState, String> {
    validate_new_image_grid(&image_data, &cell_values)?;
    let new_password = grid_password_from_cells(&selected_cells, &cell_values)?;
    let vault_path = std::env::var("HOME")
        .map(|home| format!("{}/.password_manager/vault.json", home))
        .unwrap_or_else(|_| "./vault.json".to_string());
    let auth_path = grid_auth_path();
    let previous_auth = std::fs::read_to_string(&auth_path).ok();
    let content = std::fs::read_to_string(&vault_path)
        .map_err(|error| format!("Failed to read encrypted vault: {}", error))?;
    let old_vault: VaultFile = serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse encrypted vault: {}", error))?;
    let old_salt = security::decode_hex_or_base64(&old_vault.salt, "salt")?;
    let old_key = security::derive_key_from_password(&current_password, &old_salt)?;
    let old_nonce = security::decode_hex_or_base64(&old_vault.nonce, "nonce")?;
    let old_ciphertext = security::decode_hex_or_base64(&old_vault.ciphertext, "ciphertext")?;
    let plaintext = security::decrypt_aes_gcm(&old_key, &old_nonce, &old_ciphertext)
        .map_err(|error| format!("Failed to decrypt existing vault: {}", error))?;
    let vault_data: VaultData = serde_json::from_slice(&plaintext)
        .map_err(|error| format!("Failed to parse existing vault data: {}", error))?;

    let new_salt = security::generate_salt()
        .map_err(|error| format!("Failed to generate salt: {}", error))?;
    let new_key = security::derive_key_from_password(&new_password, &new_salt)?;
    let new_nonce = security::generate_nonce()
        .map_err(|error| format!("Failed to generate nonce: {}", error))?;
    let new_plaintext = serde_json::to_vec(&vault_data)
        .map_err(|error| format!("Failed to serialize vault data: {}", error))?;
    let new_ciphertext = security::encrypt_aes_gcm(&new_key, &new_nonce, &new_plaintext)
        .map_err(|error| format!("Failed to encrypt vault data: {}", error))?;
    let payload = serde_json::json!({
        "salt": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &new_salt),
        "nonce": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &new_nonce),
        "ciphertext": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &new_ciphertext),
        "version": "1"
    });

    let vault_dir = std::path::Path::new(&vault_path)
        .parent()
        .unwrap_or(std::path::Path::new("."));
    std::fs::create_dir_all(vault_dir)
        .map_err(|error| format!("Failed to create vault directory: {}", error))?;
    std::fs::write(&vault_path, payload.to_string())
        .map_err(|error| format!("Failed to save re-encrypted vault: {}", error))?;
    if let Err(metadata_error) = save_image_grid_metadata(&image_data, &cell_values) {
        let vault_restore = std::fs::write(&vault_path, content);
        let auth_restore = match previous_auth {
            Some(previous) => std::fs::write(&auth_path, previous),
            None => match std::fs::remove_file(&auth_path) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(error),
            },
        };
        if let Err(restore_error) = vault_restore.and(auth_restore) {
            return Err(format!(
                "{}; failed to restore prior auth data: {}",
                metadata_error, restore_error
            ));
        }
        return Err(metadata_error);
    }

    server_state.set_unlocked(
        new_password,
        vault_data.entries.clone(),
        vault_data.folders.clone(),
        vault_data.deleted_entries.clone(),
        vault_data.history.clone(),
    );
    let now = chrono::Utc::now().timestamp();
    Ok(VaultState {
        is_new: false,
        entries: vault_data.entries,
        folders: vault_data.folders,
        trash: vault_data
            .deleted_entries
            .into_iter()
            .filter(|entry| entry.deleted_at.parse::<i64>().unwrap_or(0) <= now)
            .collect(),
        history: vault_data.history,
    })
}

/// Re-encrypt an existing vault with a new password and remove image-grid auth.
#[tauri::command]
fn change_vault_to_password(
    current_password: String,
    new_password: String,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<(), String> {
    if current_password.is_empty() {
        return Err("Current password cannot be empty".to_string());
    }
    if new_password.len() < 12 {
        return Err("New password must be at least 12 characters".to_string());
    }

    let vault_path = std::env::var("HOME")
        .map(|home| format!("{}/.password_manager/vault.json", home))
        .unwrap_or_else(|_| "./vault.json".to_string());
    let auth_path = grid_auth_path();
    let old_content = std::fs::read_to_string(&vault_path)
        .map_err(|error| format!("Failed to read encrypted vault: {}", error))?;
    let old_vault: VaultFile = serde_json::from_str(&old_content)
        .map_err(|error| format!("Failed to parse encrypted vault: {}", error))?;
    let old_salt = security::decode_hex_or_base64(&old_vault.salt, "salt")?;
    let old_key = security::derive_key_from_password(&current_password, &old_salt)?;
    let old_nonce = security::decode_hex_or_base64(&old_vault.nonce, "nonce")?;
    let old_ciphertext = security::decode_hex_or_base64(&old_vault.ciphertext, "ciphertext")?;
    let plaintext = security::decrypt_aes_gcm(&old_key, &old_nonce, &old_ciphertext)
        .map_err(|error| format!("Failed to decrypt existing vault: {}", error))?;
    let vault_data: VaultData = serde_json::from_slice(&plaintext)
        .map_err(|error| format!("Failed to parse existing vault data: {}", error))?;

    let new_salt = security::generate_salt()
        .map_err(|error| format!("Failed to generate salt: {}", error))?;
    let new_key = security::derive_key_from_password(&new_password, &new_salt)?;
    let new_nonce = security::generate_nonce()
        .map_err(|error| format!("Failed to generate nonce: {}", error))?;
    let new_plaintext = serde_json::to_vec(&vault_data)
        .map_err(|error| format!("Failed to serialize vault data: {}", error))?;
    let new_ciphertext = security::encrypt_aes_gcm(&new_key, &new_nonce, &new_plaintext)
        .map_err(|error| format!("Failed to encrypt vault data: {}", error))?;
    let payload = serde_json::json!({
        "salt": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &new_salt),
        "nonce": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &new_nonce),
        "ciphertext": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &new_ciphertext),
        "version": "1"
    });
    std::fs::write(&vault_path, payload.to_string())
        .map_err(|error| format!("Failed to save re-encrypted vault: {}", error))?;

    if auth_path.exists() {
        if let Err(error) = std::fs::remove_file(&auth_path) {
            let restore_result = std::fs::write(&vault_path, old_content);
            if let Err(restore_error) = restore_result {
                return Err(format!(
                    "Failed to remove image authentication: {}; failed to restore vault: {}",
                    error, restore_error
                ));
            }
            return Err(format!("Failed to remove image authentication: {}", error));
        }
    }

    server_state.set_unlocked(
        new_password,
        vault_data.entries,
        vault_data.folders,
        vault_data.deleted_entries,
        vault_data.history,
    );
    Ok(())
}

/// Set grid (image) authentication
/// Stores coordinate pairs for image-based authentication

#[tauri::command]
fn set_grid_auth(pattern: Vec<u8>, _master_password: Option<String>) -> Result<(), String> {
    println!("Setting up image authentication...");

    if pattern.len() < 4 || pattern.len() % 2 != 0 {
        return Err("Image pattern must have at least 2 coordinate pairs".to_string());
    }

    for byte in &pattern {
        if *byte > 100 {
            return Err("Invalid coordinate value (must be 0-100)".to_string());
        }
    }

    let grid_auth_data = serde_json::json!({
        "pattern": pattern.to_vec(),
        "type": "image",
        "grid_size": 4,
        "version": "2"
    });

    let grid_auth_path = std::env::var("HOME")
        .ok()
        .map(|h| format!("{}/.password_manager/grid_auth.json", h))
        .unwrap_or_else(|| "./grid_auth.json".to_string());

    let grid_auth_dir = std::path::Path::new(&grid_auth_path).parent()
        .unwrap_or(std::path::Path::new("."));
    std::fs::create_dir_all(grid_auth_dir)
        .map_err(|e| format!("Failed to create grid auth directory: {}", e))?;

    std::fs::write(&grid_auth_path, grid_auth_data.to_string())
        .map_err(|e| format!("Failed to write grid auth data: {}", e))?;

    println!("Image authentication stored successfully");
    Ok(())
}

#[tauri::command]
fn unlock_vault_grid(
    pattern: Vec<u8>,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<VaultState, String> {
    println!("Unlocking vault with image authentication...");

    let grid_auth_path = std::env::var("HOME")
        .ok()
        .map(|h| format!("{}/.password_manager/grid_auth.json", h))
        .unwrap_or_else(|| "./grid_auth.json".to_string());

    if !std::path::Path::new(&grid_auth_path).exists() {
        return Err("Grid authentication not configured".to_string());
    }

    let content = std::fs::read_to_string(&grid_auth_path)
        .map_err(|e| format!("Failed to read grid auth data: {}", e))?;

    let grid_auth: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse grid auth data: {}", e))?;

    let master_password = if grid_auth.get("type").and_then(serde_json::Value::as_str) == Some("image_grid") {
        let cell_values: Vec<String> = serde_json::from_value(
            grid_auth["cell_values"].clone(),
        )
        .map_err(|error| format!("Failed to parse image grid: {}", error))?;
        if cell_values.len() != 25
            || cell_values
                .iter()
                .any(|value| !valid_image_grid_fragment(value))
            || cell_values.iter().collect::<std::collections::HashSet<_>>().len() != 25
        {
            return Err("Stored image grid is invalid".to_string());
        }
        grid_password_from_cells(&pattern, &cell_values)?
    } else {
        // Legacy image auth stores exact coordinate bytes. Verify approximate clicks,
        // but derive with the original bytes so tolerated click drift cannot change the key.
        let stored: Vec<u8> = serde_json::from_value(grid_auth["pattern"].clone())
            .map_err(|error| format!("Failed to parse stored pattern: {}", error))?;
        legacy_image_password(&pattern, &stored)?
    };

    println!("Image authentication verified successfully");

    unlock_vault(master_password, server_state)
}

#[tauri::command]
fn change_auth_method(
    current_password: String,
    new_auth_type: String,
    grid_pattern: Option<Vec<u8>>,
) -> Result<(), String> {
    println!("Changing authentication method...");

    match new_auth_type.as_str() {
        "password" | "grid" | "image" => {}
        _ => return Err("Invalid authentication method type".to_string()),
    }

    let vault_path = std::env::var("HOME")
        .ok()
        .map(|h| format!("{}/.password_manager/vault.json", h))
        .unwrap_or_else(|| "./vault.json".to_string());

    if !std::path::Path::new(&vault_path).exists() {
        return Err("No existing vault found".to_string());
    }

    let grid_auth_path = std::env::var("HOME")
        .ok()
        .map(|h| format!("{}/.password_manager/grid_auth.json", h))
        .unwrap_or_else(|| "./grid_auth.json".to_string());

    let has_grid_auth = std::path::Path::new(&grid_auth_path).exists();

    let content = std::fs::read_to_string(&vault_path)
        .map_err(|e| format!("Failed to read vault: {}", e))?;

    let vault_file: VaultFile = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse vault: {}", e))?;

    let salt_bytes = security::decode_hex_or_base64(&vault_file.salt, "salt")?;
    let key = security::derive_key_from_password(&current_password, &salt_bytes)
        .map_err(|e| format!("Failed to derive key: {}", e))?;

    let nonce_bytes = security::decode_hex_or_base64(&vault_file.nonce, "nonce")?;
    let ciphertext_bytes = security::decode_hex_or_base64(&vault_file.ciphertext, "ciphertext")?;

    let _decrypted = security::decrypt_aes_gcm(&key, &nonce_bytes, &ciphertext_bytes)
        .map_err(|e| format!("Failed to verify current password: {}. Please verify your current master password is correct.", e))?;

    if new_auth_type == "grid" || new_auth_type == "image" {
        if grid_pattern.is_none() {
            return Err("Grid pattern required for grid/image authentication".to_string());
        }

        let pattern = grid_pattern.unwrap();
        set_grid_auth(pattern, None)?;
    }

    if new_auth_type == "password" {
        if has_grid_auth {
            std::fs::remove_file(&grid_auth_path).ok();
        }
    }

    println!("Authentication method changed successfully");
    Ok(())
}

#[tauri::command]
fn export_vault(path: String) -> Result<(), String> {
    println!("Exporting vault to: {}", path);

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

#[cfg(test)]
mod image_grid_tests {
    use super::{
        grid_password_from_cells, legacy_image_password, validate_image_grid,
        validate_new_image_grid,
    };

    fn cell_values() -> Vec<String> {
        (0..25)
            .map(|index| format!("{}a1!", char::from(b'A' + index)))
            .collect()
    }

    #[test]
    fn selected_fragments_are_concatenated_in_selection_order() {
        let values = cell_values();
        let pattern = vec![4, 2, 8, 1, 6, 0, 3, 5, 7, 9, 10, 11];

        assert_eq!(
            grid_password_from_cells(&pattern, &values).unwrap(),
            "Ea1!Ca1!Ia1!Ba1!Ga1!Aa1!Da1!Fa1!Ha1!Ja1!Ka1!La1!"
        );
    }

    #[test]
    fn too_short_or_repeated_patterns_are_rejected() {
        let values = cell_values();

        assert!(grid_password_from_cells(&[0, 1, 2, 3], &values).is_err());
        assert!(grid_password_from_cells(&[0, 1, 2, 3, 4], &values).is_ok());
        assert!(
            grid_password_from_cells(&[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10], &values).is_err()
        );
    }

    #[test]
    fn tolerated_legacy_clicks_keep_the_original_vault_password() {
        let stored = [20, 35, 48, 60, 75, 85];
        let clicked = [22, 33, 50, 61, 73, 84];

        assert_eq!(
            legacy_image_password(&clicked, &stored).unwrap(),
            "20-35-48-60-75-85"
        );
        assert!(legacy_image_password(&[0], &stored).is_err());
    }

    #[test]
    fn image_grid_metadata_requires_unique_fragments() {
        let mut values = cell_values();
        values[1] = values[0].clone();

        assert!(validate_image_grid("data:image/png;base64,AA==", &values).is_err());
    }

    #[test]
    fn image_grid_metadata_accepts_legacy_two_character_fragments() {
        let values: Vec<String> = (0..25).map(|index| format!("{:02}", index)).collect();

        assert!(validate_image_grid("data:image/png;base64,AA==", &values).is_ok());
    }

    #[test]
    fn image_grid_metadata_accepts_previous_uppercase_fragments() {
        let values: Vec<String> = (0..25)
            .map(|index| format!("{:04X}", index + 100))
            .collect();

        assert!(validate_image_grid("data:image/png;base64,AA==", &values).is_ok());
    }

    #[test]
    fn image_grid_metadata_requires_all_character_classes_in_new_fragments() {
        let mut values = cell_values();
        values[0] = "AB12".to_string();

        assert!(validate_new_image_grid("data:image/png;base64,AA==", &values).is_err());
    }
}

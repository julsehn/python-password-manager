#![deny(warnings)]

#[allow(dead_code)]
mod railway;
#[allow(dead_code)]
mod security;
#[allow(dead_code)]
pub mod server;
pub mod vault;

use railway::{SyncConfig, SyncResponse};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use server::ServerState;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use vault::visible_trash;
pub use vault::{Entry, Folder, HistoryItem, TrashedEntry, VaultData, VaultInfo, VaultState};
use zeroize::Zeroizing;

const CLOUD_SESSION_SERVICE: &str = "com.juls.caixaforta";
const CLOUD_SESSION_ACCOUNT: &str = "official-cloud-refresh";
const IMAGE_GRID_SERVICE: &str = "com.juls.caixaforta";
const IMAGE_GRID_ACCOUNT: &str = "image-grid-cell-values";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credentials {
    pub username: String,
    pub password: String,
    pub url: Option<String>,
    pub notes: Option<String>,
}

pub(crate) fn config_dir() -> PathBuf {
    dirs::home_dir()
        .expect("could not determine the current user's home directory")
        .join(".password_manager")
}

pub(crate) fn vault_path() -> PathBuf {
    std::env::var_os("VAULT_PATH")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| config_dir().join("vault.json"))
}

pub(crate) fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {}: {}", parent.display(), error))?;
    #[cfg(unix)]
    if parent == config_dir() {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("Failed to secure vault directory: {}", error))?;
    }

    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("Failed to create temporary file: {}", error))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temporary
            .as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Failed to secure temporary file: {}", error))?;
    }
    temporary
        .write_all(contents)
        .map_err(|error| format!("Failed to write temporary file: {}", error))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("Failed to flush temporary file: {}", error))?;
    temporary
        .persist(path)
        .map_err(|error| format!("Failed to replace {}: {}", path.display(), error.error))?;
    Ok(())
}

fn attach_refresh_token(
    config: &mut SyncConfig,
    stored_config: &Mutex<SyncConfig>,
) -> Result<(), String> {
    if config.refresh_token.is_empty() {
        let stored = stored_config
            .lock()
            .map_err(|_| "Failed to access Railway configuration".to_string())?;
        if stored.token == config.token
            && stored.vault_id == config.vault_id
            && (config.railway_url.is_empty() || stored.railway_url == config.railway_url)
        {
            config.refresh_token.clone_from(&stored.refresh_token);
        }
    }
    if config.refresh_token.is_empty() {
        if let Some(secret) =
            security::load_os_secret(CLOUD_SESSION_SERVICE, CLOUD_SESSION_ACCOUNT)?
        {
            let session: StoredCloudSession = serde_json::from_str(&secret)
                .map_err(|error| format!("Stored cloud session is invalid: {}", error))?;
            let configured_url = normalized_cloud_url(&config.railway_url);
            if session.railway_url == configured_url && session.vault_id == config.vault_id {
                config.refresh_token = session.refresh_token;
            }
        }
    }
    Ok(())
}

fn normalized_cloud_url(url: &str) -> String {
    let url = url.trim().trim_end_matches('/');
    if url.is_empty() {
        railway::DEFAULT_OFFICIAL_URL.to_string()
    } else {
        url.to_string()
    }
}

fn store_cloud_session(
    railway_url: &str,
    vault_id: &str,
    username: &str,
    refresh_token: String,
) -> Result<(), String> {
    if refresh_token.is_empty() {
        return Err("The cloud service did not return a refresh token".to_string());
    }
    let session = StoredCloudSession {
        railway_url: normalized_cloud_url(railway_url),
        vault_id: vault_id.to_string(),
        username: username.to_string(),
        refresh_token,
    };
    let serialized = serde_json::to_string(&session)
        .map_err(|error| format!("Failed to encode cloud session: {}", error))?;
    security::store_os_secret(CLOUD_SESSION_SERVICE, CLOUD_SESSION_ACCOUNT, &serialized)
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredCloudSession {
    railway_url: String,
    vault_id: String,
    username: String,
    refresh_token: String,
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
            update_entry,
            sync_upload_vault,
            sync_download_vault,
            auth_official_cloud,
            register_official_cloud,
            revoke_official_cloud_session,
            set_railway_sync_config,
            get_auth_info,
            generate_pairing_code,
            list_paired_clients,
            revoke_paired_client,
            get_image_grid_auth,
            set_image_grid_auth,
            init_empty_grid_vault,
            change_vault_to_image_grid,
            change_vault_to_password,
            unlock_vault_grid,
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
    let password = Zeroizing::new(password);

    let vault_data = VaultData {
        entries: vec![],
        folders: vec![],
        deleted_entries: vec![],
        history: vec![],
    };

    let data =
        serde_json::to_string(&vault_data).map_err(|e| format!("Failed to serialize: {}", e))?;

    let salt = security::generate_salt().map_err(|e| format!("Failed to generate salt: {}", e))?;

    let key = security::derive_key_from_password(&password, &salt)
        .map_err(|e| format!("Failed to derive key: {}", e))?;

    let nonce_bytes =
        security::generate_nonce().map_err(|e| format!("Failed to generate nonce: {}", e))?;
    let ciphertext = security::encrypt_aes_gcm(&key, &nonce_bytes, &data.into_bytes())
        .map_err(|e| format!("Failed to encrypt: {}", e))?;

    let vault_path = vault_path();

    let vault_dir = std::path::Path::new(&vault_path)
        .parent()
        .unwrap_or(std::path::Path::new("."));
    std::fs::create_dir_all(vault_dir)
        .map_err(|e| format!("Failed to create vault directory: {}", e))?;

    let payload = serde_json::json!({
        "salt": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &salt),
        "nonce": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &nonce_bytes),
        "ciphertext": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &ciphertext),
        "version": "1"
    });

    atomic_write(&vault_path, payload.to_string().as_bytes())?;

    println!("Vault created successfully");

    server_state.set_unlocked(password.to_string(), vec![], vec![], vec![], vec![]);

    Ok(())
}

#[tauri::command]
fn reset_vault(server_state: tauri::State<'_, Arc<ServerState>>) -> Result<(), String> {
    let vault_path = vault_path();
    let auth_path = grid_auth_path();

    if vault_path.exists() {
        std::fs::remove_file(&vault_path)
            .map_err(|e| format!("Failed to remove local vault: {}", e))?;
    }
    if auth_path.exists() {
        security::delete_os_secret(IMAGE_GRID_SERVICE, IMAGE_GRID_ACCOUNT)?;
        std::fs::remove_file(&auth_path)
            .map_err(|error| format!("Failed to remove image authentication: {}", error))?;
    }
    server_state.lock();

    Ok(())
}

#[tauri::command]
fn unlock_vault(
    master_password: String,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<VaultState, String> {
    println!("Unlocking vault...");
    let master_password = Zeroizing::new(master_password);

    let vault_path = vault_path();

    if !std::path::Path::new(&vault_path).exists() {
        println!("Vault file not found, creating new empty vault state");
        server_state.set_unlocked(master_password.to_string(), vec![], vec![], vec![], vec![]);
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

    let vault_file: VaultFile = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse vault structure: {}", e))?;

    let salt_bytes = security::decode_hex_or_base64(&vault_file.salt, "salt")?;
    let key = security::derive_key_from_password(&master_password, &salt_bytes)
        .map_err(|e| format!("Failed to derive key from password: {}", e))?;

    let nonce_bytes = security::decode_hex_or_base64(&vault_file.nonce, "nonce")?;
    let ciphertext_bytes = security::decode_hex_or_base64(&vault_file.ciphertext, "ciphertext")?;

    let decrypted =
        security::decrypt_aes_gcm(&key, &nonce_bytes, &ciphertext_bytes).map_err(|e| {
            format!(
                "Failed to decrypt vault: {}. Please verify your master password is correct.",
                e
            )
        })?;

    let data: String = String::from_utf8_lossy(&decrypted).into();
    let vault_data: VaultData = serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse decrypted vault data: {}", e))?;

    server_state.set_unlocked(
        master_password.to_string(),
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
        trash: visible_trash(vault_data.deleted_entries, now),
        history: vault_data.history,
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn save_vault(
    entries: Vec<Entry>,
    folders: Vec<Folder>,
    trash: Vec<TrashedEntry>,
    history: Vec<HistoryItem>,
    sync_to_railway: bool,
    backup_existing: Option<bool>,
    sync_state: tauri::State<'_, Mutex<SyncConfig>>,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<Option<String>, String> {
    println!("Saving vault...");
    let master_password = {
        let unlocked = server_state
            .unlocked_data
            .lock()
            .map_err(|_| "Failed to access unlocked vault".to_string())?;
        unlocked
            .as_ref()
            .ok_or_else(|| "Vault is locked".to_string())?
            .master_password
            .clone()
    };

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

    let data =
        serde_json::to_string(&vault_data).map_err(|e| format!("Failed to serialize: {}", e))?;

    let salt = security::generate_salt().map_err(|e| format!("Failed to generate salt: {}", e))?;

    let key = security::derive_key_from_password(&master_password, &salt)
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

    if backup_existing.unwrap_or(false) && vault_path.exists() {
        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S_%f");
        let backup_path = vault_path.with_extension(format!("{}.bak", timestamp));
        std::fs::copy(&vault_path, &backup_path)
            .map_err(|e| format!("Failed to back up current vault: {}", e))?;
    }
    atomic_write(&vault_path, payload.to_string().as_bytes())?;

    server_state.set_unlocked(
        master_password.to_string(),
        vault_data.entries.clone(),
        vault_data.folders.clone(),
        vault_data.deleted_entries.clone(),
        vault_data.history.clone(),
    );

    println!("Vault saved successfully");

    if sync_to_railway {
        let config = sync_state
            .lock()
            .map_err(|_| "Failed to access Railway configuration".to_string())?
            .clone();

        if !config.railway_url.is_empty() && !config.vault_id.is_empty() && !config.token.is_empty()
        {
            println!("Syncing vault to Railway...");
            railway::upload_vault(&config).await.map_err(|e| {
                format!(
                    "Railway sync failed: {}. Vault saved locally but not synced.",
                    e
                )
            })?;
            println!("Vault synced to Railway successfully");
            return Ok(Some("Synced to Railway".to_string()));
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
    let vault_path = vault_path();

    let exists = std::path::Path::new(&vault_path).exists();

    VaultInfo {
        exists,
        entry_count: 0,
        folder_count: 0,
        trash_count: 0,
    }
}

#[tauri::command]
#[allow(dead_code)]
fn generate_pairing_code(
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<String, String> {
    server_state.generate_pairing_code()
}

#[tauri::command]
#[allow(dead_code)]
fn list_paired_clients() -> Vec<server::PairedClient> {
    server::load_paired_clients()
}

#[tauri::command]
#[allow(dead_code)]
fn revoke_paired_client(
    server_state: tauri::State<'_, Arc<ServerState>>,
    client_id: String,
) -> Result<bool, String> {
    Ok(server_state.revoke_client(&client_id))
}

#[tauri::command]
fn get_vault_entries(
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<VaultState, String> {
    let unlocked = server_state.unlocked_data.lock().unwrap();
    match &*unlocked {
        Some(vault) => {
            let now = chrono::Utc::now().timestamp();
            Ok(VaultState {
                is_new: false,
                entries: vault.entries.clone(),
                folders: vault.folders.clone(),
                trash: visible_trash(vault.trash.iter().cloned(), now),
                history: vault.history.clone(),
            })
        }
        None => Err("Vault is locked".to_string()),
    }
}

#[tauri::command]
#[allow(dead_code)]
fn generate_password(
    length: u32,
    uppercase: bool,
    lowercase: bool,
    numbers: bool,
    symbols: bool,
) -> String {
    println!(
        "Generating password: length={}, uppercase={}, lowercase={}, numbers={}, symbols={}",
        length, uppercase, lowercase, numbers, symbols
    );

    security::generate_password(length, uppercase, lowercase, numbers, symbols)
}

#[tauri::command]
#[allow(dead_code)]
fn generate_passphrase(
    word_count: u32,
    separator: String,
    uppercase_words: bool,
    include_number: bool,
    remove_accents: bool,
    language: String,
) -> String {
    println!("Generating passphrase: words={}, separator={}, uppercase={}, include_number={}, language={}", word_count, separator, uppercase_words, include_number, language);

    security::generate_passphrase(
        word_count,
        separator,
        uppercase_words,
        include_number,
        remove_accents,
        language,
    )
}

#[tauri::command]
#[allow(dead_code)]
fn generate_username(
    first_name: Option<String>,
    last_name: Option<String>,
    include_numbers: bool,
) -> String {
    println!("Generating username");

    security::generate_username(first_name, last_name, include_numbers)
}

#[tauri::command]
#[allow(dead_code)]
fn create_entry(
    site: String,
    username: String,
    password: String,
    notes: String,
    folder_id: Option<String>,
) -> Result<Entry, String> {
    let _ = (site, username, password, notes, folder_id);
    Err("This legacy command is disabled; save through the encrypted vault command".to_string())
}

#[tauri::command]
fn update_entry(
    entry_id: String,
    site: String,
    username: String,
    password: String,
    notes: String,
    folder_id: Option<String>,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<Entry, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let (master_password, vault_data, updated_entry) = {
        let unlocked = server_state.unlocked_data.lock().unwrap();
        let vault = unlocked
            .as_ref()
            .ok_or_else(|| "Vault is locked".to_string())?;
        let mut vault_data = VaultData {
            entries: vault.entries.clone(),
            folders: vault.folders.clone(),
            deleted_entries: vault.trash.clone(),
            history: vault.history.clone(),
        };
        let entry = vault_data
            .entries
            .iter_mut()
            .find(|entry| entry.id == entry_id)
            .ok_or_else(|| "Entry not found".to_string())?;
        entry.site = site;
        entry.username = username;
        entry.password = password;
        entry.notes = notes;
        entry.folder_id = folder_id;
        entry.updated_at = Some(now);

        let updated_entry = entry.clone();
        (vault.master_password.clone(), vault_data, updated_entry)
    };

    server::save_vault_data(&master_password, &vault_data)?;
    server_state.set_unlocked(
        master_password.to_string(),
        vault_data.entries.clone(),
        vault_data.folders.clone(),
        vault_data.deleted_entries.clone(),
        vault_data.history.clone(),
    );

    Ok(updated_entry)
}

#[tauri::command]
#[allow(dead_code)]
fn trash_entry(entry_id: String) -> Result<(), String> {
    let _ = entry_id;
    Err("This legacy command is disabled; save through the encrypted vault command".to_string())
}

#[tauri::command]
#[allow(dead_code)]
fn restore_entry(entry_id: String) -> Result<(), String> {
    let _ = entry_id;
    Err("This legacy command is disabled; save through the encrypted vault command".to_string())
}

#[tauri::command]
#[allow(dead_code)]
fn delete_entry_permanently(entry_id: String) -> Result<(), String> {
    let _ = entry_id;
    Err("This legacy command is disabled; save through the encrypted vault command".to_string())
}

#[tauri::command]
#[allow(dead_code)]
fn create_folder(name: String, icon: String, color: String) -> Result<Folder, String> {
    let _ = (name, icon, color);
    Err("This legacy command is disabled; save through the encrypted vault command".to_string())
}

#[tauri::command]
#[allow(dead_code)]
fn update_folder(
    folder_id: String,
    name: String,
    icon: String,
    color: String,
) -> Result<Folder, String> {
    let _ = (folder_id, name, icon, color);
    Err("This legacy command is disabled; save through the encrypted vault command".to_string())
}

#[tauri::command]
#[allow(dead_code)]
fn delete_folder(folder_id: String) -> Result<(), String> {
    let _ = folder_id;
    Err("This legacy command is disabled; save through the encrypted vault command".to_string())
}

#[tauri::command]
async fn sync_upload_vault(
    mut config: SyncConfig,
    sync_state: tauri::State<'_, Mutex<SyncConfig>>,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<SyncResponse, String> {
    println!("Syncing vault to Railway: {}", config.vault_id);
    attach_refresh_token(&mut config, &sync_state)?;
    let master_password = {
        let unlocked = server_state
            .unlocked_data
            .lock()
            .map_err(|_| "Failed to access unlocked vault".to_string())?;
        unlocked
            .as_ref()
            .ok_or_else(|| "Vault is locked".to_string())?
            .master_password
            .clone()
    };

    let vault_path = vault_path();

    if !std::path::Path::new(&vault_path).exists() {
        return Err("No local vault found to sync".to_string());
    }

    let content = std::fs::read_to_string(&vault_path)
        .map_err(|e| format!("Failed to read local vault file: {}", e))?;

    let vault_file: VaultFile = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse vault structure: {}", e))?;

    let salt_bytes = security::decode_hex_or_base64(&vault_file.salt, "salt")?;
    let key = security::derive_key_from_password(&master_password, &salt_bytes)
        .map_err(|e| format!("Failed to derive key: {}", e))?;

    let nonce_bytes = security::decode_hex_or_base64(&vault_file.nonce, "nonce")?;
    let ciphertext_bytes = security::decode_hex_or_base64(&vault_file.ciphertext, "ciphertext")?;

    let decrypted =
        security::decrypt_aes_gcm(&key, &nonce_bytes, &ciphertext_bytes).map_err(|e| {
            format!(
                "Failed to decrypt vault: {}. Please verify your master password.",
                e
            )
        })?;

    let _data: String = String::from_utf8_lossy(&decrypted).into();

    railway::upload_vault(&config).await
}

#[tauri::command]
async fn sync_download_vault(
    master_password: Option<String>,
    mut config: SyncConfig,
    sync_state: tauri::State<'_, Mutex<SyncConfig>>,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<String, String> {
    println!("Downloading vault from Railway: {}", config.vault_id);
    attach_refresh_token(&mut config, &sync_state)?;
    let master_password = match master_password.filter(|password| !password.is_empty()) {
        Some(password) => Zeroizing::new(password),
        None => {
            let unlocked = server_state
                .unlocked_data
                .lock()
                .map_err(|_| "Failed to access unlocked vault".to_string())?;
            unlocked
                .as_ref()
                .ok_or_else(|| "Master password is required to download while locked".to_string())?
                .master_password
                .clone()
        }
    };
    let blob = railway::download_vault(master_password.to_string(), &config).await?;

    // 1. Verify downloaded vault structure
    let vault_file: VaultFile = serde_json::from_str(&blob)
        .map_err(|e| format!("Failed to parse downloaded vault structure: {}", e))?;

    // 2. Derive key with Argon2id and decrypt to verify integrity and master password
    let salt_bytes = security::decode_hex_or_base64(&vault_file.salt, "salt")?;
    let key = security::derive_key_from_password(&master_password, &salt_bytes)
        .map_err(|e| format!("Failed to derive key: {}", e))?;

    let nonce_bytes = security::decode_hex_or_base64(&vault_file.nonce, "nonce")?;
    let ciphertext_bytes = security::decode_hex_or_base64(&vault_file.ciphertext, "ciphertext")?;

    let decrypted =
        security::decrypt_aes_gcm(&key, &nonce_bytes, &ciphertext_bytes).map_err(|e| {
            format!(
                "Failed to decrypt downloaded vault: {}. Please verify your master password.",
                e
            )
        })?;

    // 3. Verify that decrypted content is valid VaultData
    let data: String = String::from_utf8_lossy(&decrypted).into();
    let vault_data: VaultData = serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse decrypted vault: {}", e))?;

    // 4. Decryption and validation succeeded!
    // Safely update the local vault file only now.
    let vault_path = vault_path();

    if vault_path.exists() {
        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S_%f");
        let backup_path = vault_path.with_extension(format!("{}.bak", timestamp));
        std::fs::copy(&vault_path, &backup_path)
            .map_err(|e| format!("Failed to back up local vault before sync: {}", e))?;
    }

    atomic_write(&vault_path, blob.as_bytes())?;

    // 7. Update active in-memory session for autofill server
    server_state.set_unlocked(
        master_password.to_string(),
        vault_data.entries.clone(),
        vault_data.folders.clone(),
        vault_data.deleted_entries.clone(),
        vault_data.history.clone(),
    );

    serde_json::to_string(&vault_data).map_err(|e| format!("Failed to serialize vault: {}", e))
}

#[tauri::command]
#[allow(dead_code)]
async fn register_vault(
    master_password: String,
    config: SyncConfig,
) -> Result<SyncResponse, String> {
    railway::register_vault(master_password, &config).await
}

#[tauri::command]
async fn auth_official_cloud(
    username: String,
    password: String,
    railway_url: Option<String>,
    state: tauri::State<'_, Mutex<SyncConfig>>,
) -> Result<railway::AuthResponseData, String> {
    let mut auth = railway::auth_user(&username, &password, railway_url.as_deref()).await?;
    let refresh_token = std::mem::take(&mut auth.refresh_token);
    let url = normalized_cloud_url(railway_url.as_deref().unwrap_or_default());
    store_cloud_session(&url, &auth.vault_id, &auth.username, refresh_token.clone())?;
    let mut config = state
        .lock()
        .map_err(|_| "Failed to access Railway configuration".to_string())?;
    *config = SyncConfig {
        railway_url: url,
        vault_id: auth.vault_id.clone(),
        token: auth.access_token.clone(),
        refresh_token,
    };
    Ok(auth)
}

#[tauri::command]
async fn register_official_cloud(
    username: String,
    password: String,
    railway_url: Option<String>,
    state: tauri::State<'_, Mutex<SyncConfig>>,
) -> Result<railway::AuthResponseData, String> {
    let mut auth = railway::register_user(&username, &password, railway_url.as_deref()).await?;
    let refresh_token = std::mem::take(&mut auth.refresh_token);
    let url = normalized_cloud_url(railway_url.as_deref().unwrap_or_default());
    store_cloud_session(&url, &auth.vault_id, &auth.username, refresh_token.clone())?;
    let mut config = state
        .lock()
        .map_err(|_| "Failed to access Railway configuration".to_string())?;
    *config = SyncConfig {
        railway_url: url,
        vault_id: auth.vault_id.clone(),
        token: auth.access_token.clone(),
        refresh_token,
    };
    Ok(auth)
}

#[tauri::command]
async fn revoke_official_cloud_session(
    railway_url: String,
    vault_id: String,
    state: tauri::State<'_, Mutex<SyncConfig>>,
) -> Result<(), String> {
    let mut config = state
        .lock()
        .map_err(|_| "Failed to access Railway configuration".to_string())?
        .clone();
    config.railway_url = normalized_cloud_url(&railway_url);
    config.vault_id = vault_id;
    attach_refresh_token(&mut config, &state)?;
    let result = railway::revoke_refresh_token(&config).await;
    if result.is_ok() {
        security::delete_os_secret(CLOUD_SESSION_SERVICE, CLOUD_SESSION_ACCOUNT)?;
    }
    if let Ok(mut config) = state.lock() {
        config.token.clear();
        config.refresh_token.clear();
    }
    result
}

#[tauri::command]
#[allow(dead_code)]
async fn check_cloud_health(railway_url: Option<String>) -> Result<bool, String> {
    railway::check_health(railway_url.as_deref()).await
}

#[tauri::command]
#[allow(dead_code)]
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

    let url = if railway_url.trim().is_empty() {
        railway::DEFAULT_OFFICIAL_URL.to_string()
    } else {
        railway_url.trim().to_string()
    };

    let mut config = state
        .lock()
        .map_err(|_| "Failed to access Railway configuration".to_string())?;
    let refresh_token =
        if config.railway_url == url && config.vault_id == vault_id && config.token == token {
            config.refresh_token.clone()
        } else {
            String::new()
        };
    *config = SyncConfig {
        railway_url: url,
        vault_id,
        token,
        refresh_token,
    };

    println!("Railway sync configured successfully");
    Ok(())
}

#[tauri::command]
#[allow(dead_code)]
fn get_railway_sync_config(
    state: tauri::State<'_, Mutex<SyncConfig>>,
) -> Result<SyncConfig, String> {
    state
        .lock()
        .map(|config| config.clone())
        .map_err(|_| "Failed to access Railway configuration".to_string())
}

#[tauri::command]
#[allow(dead_code)]
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

    let vault_path = vault_path();

    if !std::path::Path::new(&vault_path).exists() {
        return Err(
            "No existing vault found. Create a vault first with your master password.".to_string(),
        );
    }

    let content = std::fs::read_to_string(&vault_path)
        .map_err(|e| format!("Failed to read encrypted vault file: {}", e))?;

    let old_vault_file: VaultFile = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse encrypted vault structure: {}", e))?;

    let old_salt_bytes = security::decode_hex_or_base64(&old_vault_file.salt, "salt")?;
    let old_key = security::derive_key_from_password(&current_password, &old_salt_bytes)
        .map_err(|e| format!("Failed to derive key with current password: {}", e))?;

    let old_nonce_bytes = security::decode_hex_or_base64(&old_vault_file.nonce, "nonce")?;
    let old_ciphertext_bytes =
        security::decode_hex_or_base64(&old_vault_file.ciphertext, "ciphertext")?;

    let decrypted = security::decrypt_aes_gcm(&old_key, &old_nonce_bytes, &old_ciphertext_bytes).map_err(|e| {
        format!("Failed to decrypt vault with current password: {}. Please verify your current master password is correct.", e)
    })?;

    let old_data: String = String::from_utf8_lossy(&decrypted).into();
    let old_vault_data: VaultData = serde_json::from_str(&old_data)
        .map_err(|e| format!("Failed to parse decrypted vault data: {}", e))?;

    println!("Successfully decrypted vault with current password");

    let new_vault_data = VaultData {
        entries: old_vault_data.entries,
        folders: old_vault_data.folders,
        deleted_entries: old_vault_data.deleted_entries,
        history: old_vault_data.history,
    };

    let new_salt =
        security::generate_salt().map_err(|e| format!("Failed to generate salt: {}", e))?;
    let new_key = security::derive_key_from_password(&new_password, &new_salt)
        .map_err(|e| format!("Failed to derive key with new password: {}", e))?;
    let new_nonce_bytes =
        security::generate_nonce().map_err(|e| format!("Failed to generate nonce: {}", e))?;
    let new_data = serde_json::to_string(&new_vault_data)
        .map_err(|e| format!("Failed to serialize updated vault: {}", e))?;
    let new_ciphertext =
        security::encrypt_aes_gcm(&new_key, &new_nonce_bytes, &new_data.into_bytes())
            .map_err(|e| format!("Failed to re-encrypt vault with new password: {}", e))?;

    let payload = serde_json::json!({
        "salt": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &new_salt),
        "nonce": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &new_nonce_bytes),
        "ciphertext": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &new_ciphertext),
        "version": "1"
    });

    atomic_write(&vault_path, payload.to_string().as_bytes())?;

    println!("Master password changed successfully - vault re-encrypted with new password");
    Ok(())
}

#[tauri::command]
fn get_auth_info() -> Result<VaultInfo, String> {
    let path = grid_auth_path();
    let exists = path.exists();
    if exists {
        let supported = std::fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
            .map(|metadata| {
                metadata.get("type").and_then(serde_json::Value::as_str) == Some("image_grid")
                    && metadata.get("version").and_then(serde_json::Value::as_u64) == Some(5)
            })
            .unwrap_or(false);
        if !supported {
            std::fs::remove_file(&path).map_err(|error| {
                format!(
                    "Failed to remove unsupported image authentication: {}",
                    error
                )
            })?;
            security::delete_os_secret(IMAGE_GRID_SERVICE, IMAGE_GRID_ACCOUNT)?;
            return Ok(VaultInfo {
                exists: false,
                entry_count: 0,
                folder_count: 0,
                trash_count: 0,
            });
        }
    }

    Ok(VaultInfo {
        exists: path.exists(),
        entry_count: 0,
        folder_count: 0,
        trash_count: 0,
    })
}

fn grid_auth_path() -> std::path::PathBuf {
    config_dir().join("grid_auth.json")
}

fn grid_password_from_cells_with_minimum(
    cells: &[u8],
    cell_values: &[String],
    minimum: usize,
) -> Result<String, String> {
    let mut seen = std::collections::HashSet::new();
    if cells.len() < minimum || cells.iter().any(|cell| *cell >= 25 || !seen.insert(*cell)) {
        return Err(format!(
            "Select at least {} unique valid grid cells",
            minimum
        ));
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

fn validate_image_grid(image_data: &str, cell_values: &[String]) -> Result<(), String> {
    if !image_data.starts_with("data:image/") || image_data.len() > 20_000_000 {
        return Err("Invalid image data".to_string());
    }
    validate_grid_cell_values(cell_values)
}

fn validate_new_image_grid(image_data: &str, cell_values: &[String]) -> Result<(), String> {
    validate_image_grid(image_data, cell_values)?;
    Ok(())
}

fn validate_grid_cell_values(cell_values: &[String]) -> Result<(), String> {
    if cell_values.len() != 25
        || cell_values.iter().any(|value| {
            let bytes = value.as_bytes();
            bytes.len() != 4
                || !bytes.iter().any(u8::is_ascii_uppercase)
                || !bytes.iter().any(u8::is_ascii_lowercase)
                || !bytes.iter().any(u8::is_ascii_digit)
                || !bytes
                    .iter()
                    .any(|byte| b"!@#$%^&*()-_=+[]{}".contains(byte))
        })
        || cell_values
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != 25
    {
        return Err("Grid cells must be 25 unique 4-character mixed fragments".to_string());
    }
    Ok(())
}

fn generate_grid_cell_values() -> Zeroizing<Vec<String>> {
    const CHARACTER_SETS: [&[u8]; 4] = [
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        b"abcdefghijklmnopqrstuvwxyz",
        b"0123456789",
        b"!@#$%^&*()-_=+[]{}",
    ];
    let mut fragments: Zeroizing<Vec<String>> = Zeroizing::new(Vec::with_capacity(25));
    let random_index = |limit: usize| {
        let range = u32::MAX as u64 + 1;
        let cutoff = range - (range % limit as u64);
        loop {
            let value = OsRng.next_u32() as u64;
            if value < cutoff {
                break (value % limit as u64) as usize;
            }
        }
    };
    while fragments.len() < 25 {
        let mut bytes = CHARACTER_SETS
            .iter()
            .map(|set| set[random_index(set.len())])
            .collect::<Vec<_>>();
        for index in (1..bytes.len()).rev() {
            let swap_index = random_index(index + 1);
            bytes.swap(index, swap_index);
        }
        let fragment = Zeroizing::new(
            String::from_utf8(bytes).expect("generated fragments are ASCII"),
        );
        if !fragments.contains(&fragment) {
            fragments.push(fragment.to_string());
        }
    }
    fragments
}

fn load_image_grid_cell_values() -> Result<Zeroizing<Vec<String>>, String> {
    let encoded =
        security::load_os_secret(IMAGE_GRID_SERVICE, IMAGE_GRID_ACCOUNT)?.ok_or_else(|| {
            "Image-grid secret is missing from the secure credential store".to_string()
        })?;
    let encoded = Zeroizing::new(encoded);
    let values: Zeroizing<Vec<String>> = Zeroizing::new(
        serde_json::from_str(&encoded)
            .map_err(|error| format!("Stored image-grid secret is invalid: {}", error))?,
    );
    validate_grid_cell_values(&values)?;
    Ok(values)
}

fn save_image_grid_metadata(image_data: &str, cell_values: &[String]) -> Result<(), String> {
    validate_new_image_grid(image_data, cell_values)?;
    let auth_data = serde_json::json!({
        "type": "image_grid",
        "version": 5,
        "image_data": image_data,
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
    let new_secret = Zeroizing::new(
        serde_json::to_string(cell_values)
            .map_err(|error| format!("Failed to encode image-grid secret: {}", error))?,
    );
    let previous_secret =
        security::load_os_secret(IMAGE_GRID_SERVICE, IMAGE_GRID_ACCOUNT)?.map(Zeroizing::new);
    security::store_os_secret(IMAGE_GRID_SERVICE, IMAGE_GRID_ACCOUNT, &new_secret)?;
    if let Err(write_error) = atomic_write(&path, auth_data.to_string().as_bytes()) {
        let restore_result = match previous_secret {
            Some(secret) => {
                security::store_os_secret(IMAGE_GRID_SERVICE, IMAGE_GRID_ACCOUNT, &secret)
            }
            None => security::delete_os_secret(IMAGE_GRID_SERVICE, IMAGE_GRID_ACCOUNT),
        };
        if let Err(restore_error) = restore_result {
            return Err(format!(
                "{}; failed to restore prior image-grid secret: {}",
                write_error, restore_error
            ));
        }
        return Err(write_error);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Failed to secure grid auth data: {}", error))?;
    }
    Ok(())
}

/// Return the public image used by the image auth screen.
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
    if data.get("type").and_then(serde_json::Value::as_str) != Some("image_grid")
        || data.get("version").and_then(serde_json::Value::as_u64) != Some(5)
    {
        return Err("Unsupported image authentication format".to_string());
    }
    Ok(Some(data))
}

/// Persist the public image and keep generated cell fragments in the OS credential store.
#[tauri::command]
fn set_image_grid_auth(image_data: String, selected_cells: Vec<u8>) -> Result<(), String> {
    let cell_values = generate_grid_cell_values();
    validate_new_image_grid(&image_data, &cell_values)?;
    let _password = Zeroizing::new(grid_password_from_cells_with_minimum(
        &selected_cells,
        &cell_values,
        12,
    )?);
    save_image_grid_metadata(&image_data, &cell_values)
}

#[tauri::command]
async fn init_empty_grid_vault(
    selected_cells: Vec<u8>,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<(), String> {
    let cell_values = load_image_grid_cell_values()?;
    let metadata_content = std::fs::read_to_string(grid_auth_path())
        .map_err(|error| format!("Failed to read image authentication: {}", error))?;
    let metadata: serde_json::Value = serde_json::from_str(&metadata_content)
        .map_err(|error| format!("Failed to parse image authentication: {}", error))?;
    if metadata.get("type").and_then(serde_json::Value::as_str) != Some("image_grid")
        || metadata.get("version").and_then(serde_json::Value::as_u64) != Some(5)
    {
        return Err("Unsupported image authentication format".to_string());
    }
    let password = grid_password_from_cells_with_minimum(&selected_cells, &cell_values, 12)?;
    init_empty_vault(password, server_state).await
}

/// Re-encrypt an existing vault using the selected image-grid fragments.
#[tauri::command]
fn change_vault_to_image_grid(
    selected_cells: Vec<u8>,
    image_data: String,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<VaultState, String> {
    let cell_values = generate_grid_cell_values();
    validate_new_image_grid(&image_data, &cell_values)?;
    let new_password = Zeroizing::new(grid_password_from_cells_with_minimum(
        &selected_cells,
        &cell_values,
        12,
    )?);
    let current_password = {
        let unlocked = server_state
            .unlocked_data
            .lock()
            .map_err(|_| "Failed to access unlocked vault".to_string())?;
        unlocked
            .as_ref()
            .ok_or_else(|| "Vault is locked".to_string())?
            .master_password
            .clone()
    };
    let vault_path = vault_path();
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

    let new_salt =
        security::generate_salt().map_err(|error| format!("Failed to generate salt: {}", error))?;
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

    atomic_write(&vault_path, payload.to_string().as_bytes())?;
    if let Err(metadata_error) = save_image_grid_metadata(&image_data, &cell_values) {
        let vault_restore = atomic_write(&vault_path, content.as_bytes());
        let auth_restore = match previous_auth {
            Some(previous) => atomic_write(&auth_path, previous.as_bytes()),
            None => match std::fs::remove_file(&auth_path) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(error.to_string()),
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
        new_password.to_string(),
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
    new_password: String,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<(), String> {
    if new_password.len() < 12 {
        return Err("New password must be at least 12 characters".to_string());
    }
    let new_password = Zeroizing::new(new_password);
    let current_password = {
        let unlocked = server_state
            .unlocked_data
            .lock()
            .map_err(|_| "Failed to access unlocked vault".to_string())?;
        unlocked
            .as_ref()
            .ok_or_else(|| "Vault is locked".to_string())?
            .master_password
            .clone()
    };

    let vault_path = vault_path();
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

    let new_salt =
        security::generate_salt().map_err(|error| format!("Failed to generate salt: {}", error))?;
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
    atomic_write(&vault_path, payload.to_string().as_bytes())?;

    if auth_path.exists() {
        let previous_secret =
            security::load_os_secret(IMAGE_GRID_SERVICE, IMAGE_GRID_ACCOUNT)?.map(Zeroizing::new);
        if let Err(error) = security::delete_os_secret(IMAGE_GRID_SERVICE, IMAGE_GRID_ACCOUNT) {
            atomic_write(&vault_path, old_content.as_bytes())?;
            return Err(error);
        }
        if let Err(error) = std::fs::remove_file(&auth_path) {
            let restore_secret = match previous_secret {
                Some(secret) => {
                    security::store_os_secret(IMAGE_GRID_SERVICE, IMAGE_GRID_ACCOUNT, &secret)
                }
                None => Ok(()),
            };
            let restore_vault = atomic_write(&vault_path, old_content.as_bytes());
            if let Err(restore_error) = restore_secret.and(restore_vault) {
                return Err(format!(
                    "Failed to remove image authentication: {}; failed to restore state: {}",
                    error, restore_error
                ));
            }
            return Err(format!("Failed to remove image authentication: {}", error));
        }
    }

    server_state.set_unlocked(
        new_password.to_string(),
        vault_data.entries,
        vault_data.folders,
        vault_data.deleted_entries,
        vault_data.history,
    );
    Ok(())
}

#[tauri::command]
fn unlock_vault_grid(
    pattern: Vec<u8>,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<VaultState, String> {
    println!("Unlocking vault with image authentication...");

    let grid_auth_path = grid_auth_path();

    if !std::path::Path::new(&grid_auth_path).exists() {
        return Err("Grid authentication not configured".to_string());
    }

    let content = std::fs::read_to_string(&grid_auth_path)
        .map_err(|e| format!("Failed to read grid auth data: {}", e))?;

    let grid_auth: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse grid auth data: {}", e))?;

    if grid_auth.get("type").and_then(serde_json::Value::as_str) != Some("image_grid")
        || grid_auth.get("version").and_then(serde_json::Value::as_u64) != Some(5)
    {
        return Err("Unsupported image authentication format".to_string());
    }
    let cell_values = load_image_grid_cell_values()?;
    let master_password = grid_password_from_cells_with_minimum(&pattern, &cell_values, 12)?;

    println!("Image authentication verified successfully");

    unlock_vault(master_password, server_state)
}

#[tauri::command]
#[allow(dead_code)]
fn export_vault(path: String) -> Result<(), String> {
    let _ = path;
    Err("Legacy path-based export is disabled; use the frontend export flow".to_string())
}

#[tauri::command]
#[allow(dead_code)]
fn import_vault(path: String) -> Result<(), String> {
    let _ = path;
    Err("Legacy path-based import is disabled; use the frontend import flow".to_string())
}

#[cfg(test)]
mod image_grid_tests {
    use super::{
        grid_password_from_cells_with_minimum, validate_image_grid, validate_new_image_grid,
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
            grid_password_from_cells_with_minimum(&pattern, &values, 12).unwrap(),
            "Ea1!Ca1!Ia1!Ba1!Ga1!Aa1!Da1!Fa1!Ha1!Ja1!Ka1!La1!"
        );
    }

    #[test]
    fn too_short_or_repeated_patterns_are_rejected() {
        let values = cell_values();

        assert!(grid_password_from_cells_with_minimum(
            &[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            &values,
            12
        )
        .is_err());
        assert!(grid_password_from_cells_with_minimum(
            &[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
            &values,
            12
        )
        .is_ok());
        assert!(grid_password_from_cells_with_minimum(
            &[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10],
            &values,
            12
        )
        .is_err());
    }

    #[test]
    fn new_image_grid_requires_twelve_unique_cells() {
        let values = cell_values();
        let eleven_cells = (0..11).collect::<Vec<_>>();
        let twelve_cells = (0..12).collect::<Vec<_>>();

        assert!(grid_password_from_cells_with_minimum(&eleven_cells, &values, 12).is_err());
        assert!(grid_password_from_cells_with_minimum(&twelve_cells, &values, 12).is_ok());
    }

    #[test]
    fn image_grid_metadata_requires_unique_fragments() {
        let mut values = cell_values();
        values[1] = values[0].clone();

        assert!(validate_image_grid("data:image/png;base64,AA==", &values).is_err());
    }

    #[test]
    fn image_grid_metadata_rejects_legacy_two_character_fragments() {
        let values: Vec<String> = (0..25).map(|index| format!("{:02}", index)).collect();

        assert!(validate_image_grid("data:image/png;base64,AA==", &values).is_err());
    }

    #[test]
    fn image_grid_metadata_rejects_previous_uppercase_fragments() {
        let values: Vec<String> = (0..25)
            .map(|index| format!("{:04X}", index + 100))
            .collect();

        assert!(validate_image_grid("data:image/png;base64,AA==", &values).is_err());
    }

    #[test]
    fn image_grid_metadata_requires_all_character_classes_in_new_fragments() {
        let mut values = cell_values();
        values[0] = "AB12".to_string();

        assert!(validate_new_image_grid("data:image/png;base64,AA==", &values).is_err());
    }
}

#[cfg(test)]
mod persistence_tests {
    use super::atomic_write;

    #[test]
    fn atomic_write_replaces_an_existing_vault_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("vault.json");

        atomic_write(&path, b"old vault").unwrap();
        atomic_write(&path, b"new vault").unwrap();

        assert_eq!(std::fs::read(path).unwrap(), b"new vault");
    }
}

#[cfg(test)]
mod sync_download_tests {
    use super::*;

    #[test]
    fn invalid_downloaded_blob_fails_validation() {
        let corrupt_blob = "not a valid json blob";
        let parse_result = serde_json::from_str::<VaultFile>(corrupt_blob);
        assert!(parse_result.is_err());
    }

    #[test]
    fn downloaded_blob_with_wrong_password_fails_decryption() {
        let salt = vec![1u8; 16];
        let key = security::derive_key_from_password("correct_password", &salt).unwrap();
        let nonce = security::generate_nonce().unwrap();
        let payload = r#"{"entries":[],"folders":[],"deleted_entries":[],"history":[]}"#;
        let ciphertext = security::encrypt_aes_gcm(&key, &nonce, payload.as_bytes()).unwrap();

        let wrong_key = security::derive_key_from_password("wrong_password", &salt).unwrap();
        let decrypt_result = security::decrypt_aes_gcm(&wrong_key, &nonce, &ciphertext);
        assert!(
            decrypt_result.is_err(),
            "Decryption must fail when password does not match"
        );
    }
}

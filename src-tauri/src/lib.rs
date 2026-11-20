#![deny(warnings)]

mod image_grid;
#[allow(dead_code)]
mod railway;
#[allow(dead_code)]
mod security;
#[allow(dead_code)]
pub mod server;
pub mod vault;

use railway::{SyncConfig, SyncResponse};
use serde::{Deserialize, Serialize};
use server::ServerState;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use vault::visible_trash;
pub use vault::{Entry, Folder, HistoryItem, TrashedEntry, VaultData, VaultInfo, VaultState};
use zeroize::Zeroizing;

const CLOUD_SESSION_SERVICE: &str = "com.juls.sherlock";
const CLOUD_SESSION_ACCOUNT: &str = "official-cloud-refresh";

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

pub(crate) fn cloud_version_path() -> PathBuf {
    std::env::var_os("CLOUD_VERSION_PATH")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| config_dir().join("cloud_version"))
}

pub(crate) fn store_cloud_version(version: i64) -> Result<(), String> {
    atomic_write(&cloud_version_path(), version.to_string().as_bytes())
}

pub(crate) fn load_cloud_version() -> Option<i64> {
    let path = cloud_version_path();
    if path.exists() {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| s.trim().parse::<i64>().ok())
    } else {
        None
    }
}

pub(crate) fn delete_cloud_version() {
    let path = cloud_version_path();
    let _ = std::fs::remove_file(path);
}

fn attach_sync_metadata(
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
    if config.cloud_version.is_none() {
        if let Ok(stored) = stored_config.lock() {
            if stored.cloud_version.is_some() {
                config.cloud_version = stored.cloud_version;
            }
        }
        if config.cloud_version.is_none() {
            config.cloud_version = load_cloud_version();
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
pub(crate) struct VaultFile {
    salt: String,
    nonce: String,
    ciphertext: String,
    version: String,
}

const VAULT_FORMAT_VERSION: &str = "1";

pub(crate) fn parse_vault_file(content: &str) -> Result<VaultFile, String> {
    let vault_file: VaultFile = serde_json::from_str(content)
        .map_err(|e| format!("Failed to parse vault structure: {}", e))?;
    if vault_file.version != VAULT_FORMAT_VERSION {
        return Err(format!(
            "Unsupported vault version '{}' (expected '{}').",
            vault_file.version, VAULT_FORMAT_VERSION
        ));
    }
    Ok(vault_file)
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
            println!("SherLock Tauri application started");
            server_state_setup.set_app_handle(app.handle().clone());
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::start_server(server_state_clone, 8080).await {
                    eprintln!("SherLock Extension Server error: {}", e);
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
            get_cloud_version,
            image_grid::get_auth_info,
            generate_pairing_code,
            list_paired_clients,
            revoke_paired_client,
            image_grid::get_image_grid_auth,
            image_grid::set_image_grid_auth,
            image_grid::init_empty_grid_vault,
            image_grid::change_vault_to_image_grid,
            image_grid::change_vault_to_password,
            image_grid::unlock_vault_grid,
        ])
        .manage(Mutex::new(SyncConfig {
            cloud_version: load_cloud_version(),
            ..SyncConfig::default()
        }))
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

pub(crate) async fn init_empty_vault_from_grid(
    password: String,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<(), String> {
    init_empty_vault(password, server_state).await
}

#[tauri::command]
fn reset_vault(server_state: tauri::State<'_, Arc<ServerState>>) -> Result<(), String> {
    let vault_path = vault_path();
    if vault_path.exists() {
        std::fs::remove_file(&vault_path)
            .map_err(|error| format!("Failed to remove local vault: {}", error))?;
    }
    image_grid::remove_image_auth()?;
    delete_cloud_version();

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

    let vault_file = parse_vault_file(&content)?;

    let salt_bytes = security::decode_base64(&vault_file.salt, "salt")?;
    let key = security::derive_key_from_password(&master_password, &salt_bytes)
        .map_err(|e| format!("Failed to derive key from password: {}", e))?;

    let nonce_bytes = security::decode_base64(&vault_file.nonce, "nonce")?;
    let ciphertext_bytes = security::decode_base64(&vault_file.ciphertext, "ciphertext")?;

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

pub(crate) fn unlock_vault_from_grid(
    master_password: String,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<VaultState, String> {
    unlock_vault(master_password, server_state)
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

    let vault_data = VaultData {
        entries,
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
    let unlocked = server_state
        .unlocked_data
        .lock()
        .unwrap_or_else(|e| e.into_inner());
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

// generate_password command removed (dead code). Use server.rs /api/v1/generate-password instead.

// generate_passphrase command removed (dead code).

// generate_username command removed (dead code).

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
        let unlocked = server_state
            .unlocked_data
            .lock()
            .unwrap_or_else(|e| e.into_inner());
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
async fn sync_upload_vault(
    mut config: SyncConfig,
    sync_state: tauri::State<'_, Mutex<SyncConfig>>,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<SyncResponse, String> {
    attach_sync_metadata(&mut config, &sync_state)?;
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

    let vault_file = parse_vault_file(&content)?;

    let salt_bytes = security::decode_base64(&vault_file.salt, "salt")?;
    let key = security::derive_key_from_password(&master_password, &salt_bytes)
        .map_err(|e| format!("Failed to derive key: {}", e))?;

    let nonce_bytes = security::decode_base64(&vault_file.nonce, "nonce")?;
    let ciphertext_bytes = security::decode_base64(&vault_file.ciphertext, "ciphertext")?;

    let decrypted =
        security::decrypt_aes_gcm(&key, &nonce_bytes, &ciphertext_bytes).map_err(|e| {
            format!(
                "Failed to decrypt vault: {}. Please verify your master password.",
                e
            )
        })?;

    let _data: String = String::from_utf8_lossy(&decrypted).into();

    match railway::upload_vault(&config).await? {
        railway::UploadResult::Ok(response, version) => {
            let _ = store_cloud_version(version);
            if let Ok(mut sync_config) = sync_state.lock() {
                sync_config.cloud_version = Some(version);
            }
            Ok(response)
        }
        railway::UploadResult::Conflict => Err(
            "La caixa al núvol és més nova que la local. Descarregueu-la abans de tornar a pujar."
                .to_string(),
        ),
    }
}

#[tauri::command]
async fn sync_download_vault(
    master_password: Option<String>,
    mut config: SyncConfig,
    sync_state: tauri::State<'_, Mutex<SyncConfig>>,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<String, String> {
    attach_sync_metadata(&mut config, &sync_state)?;
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
    let (blob, remote_version) =
        railway::download_vault(master_password.to_string(), &config).await?;

    // 1. Verify downloaded vault structure
    let vault_file = parse_vault_file(&blob)?;

    // 2. Derive key with Argon2id and decrypt to verify integrity and master password
    let salt_bytes = security::decode_base64(&vault_file.salt, "salt")?;
    let key = security::derive_key_from_password(&master_password, &salt_bytes)
        .map_err(|e| format!("Failed to derive key: {}", e))?;

    let nonce_bytes = security::decode_base64(&vault_file.nonce, "nonce")?;
    let ciphertext_bytes = security::decode_base64(&vault_file.ciphertext, "ciphertext")?;

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

    // Emmagatzema la versió del núvol per a futures pujades amb expected_version.
    let _ = store_cloud_version(remote_version);
    if let Ok(mut sync_config) = sync_state.lock() {
        sync_config.cloud_version = Some(remote_version);
    }

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
        cloud_version: load_cloud_version(),
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
        cloud_version: load_cloud_version(),
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
    attach_sync_metadata(&mut config, &state)?;
    let result = railway::revoke_refresh_token(&config).await;
    if result.is_ok() {
        security::delete_os_secret(CLOUD_SESSION_SERVICE, CLOUD_SESSION_ACCOUNT)?;
    }
    delete_cloud_version();
    if let Ok(mut config) = state.lock() {
        config.token.clear();
        config.refresh_token.clear();
        config.cloud_version = None;
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
fn get_cloud_version(sync_state: tauri::State<'_, Mutex<SyncConfig>>) -> Option<i64> {
    sync_state
        .lock()
        .ok()
        .and_then(|c| c.cloud_version)
        .or_else(load_cloud_version)
}

#[tauri::command]
fn set_railway_sync_config(
    railway_url: String,
    vault_id: String,
    token: String,
    cloud_version: Option<i64>,
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
    let effective_version = cloud_version
        .or(config.cloud_version)
        .or_else(load_cloud_version);
    if let Some(v) = effective_version {
        let _ = store_cloud_version(v);
    }
    *config = SyncConfig {
        railway_url: url,
        vault_id,
        token,
        refresh_token,
        cloud_version: effective_version,
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

// change_master_password command removed (dead code).

// Image-grid authentication commands live in image_grid.rs.

// export_vault/import_vault path-based commands removed (dead code).

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

    static SYNC_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn cloud_version_stores_and_loads_correctly() {
        let _guard = SYNC_ENV_LOCK.lock().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("cloud_version");
        std::env::set_var("CLOUD_VERSION_PATH", &path);

        assert_eq!(load_cloud_version(), None);
        store_cloud_version(42).unwrap();
        assert_eq!(load_cloud_version(), Some(42));

        delete_cloud_version();
        assert_eq!(load_cloud_version(), None);

        std::env::remove_var("CLOUD_VERSION_PATH");
    }

    #[test]
    fn attach_sync_metadata_populates_cloud_version_when_none() {
        let _guard = SYNC_ENV_LOCK.lock().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("cloud_version");
        std::env::set_var("CLOUD_VERSION_PATH", &path);
        store_cloud_version(15).unwrap();

        let mut config = SyncConfig {
            railway_url: "https://example.test".to_string(),
            vault_id: "v-1".to_string(),
            token: "tok-1".to_string(),
            refresh_token: "ref-1".to_string(),
            cloud_version: None,
        };
        let stored = Mutex::new(SyncConfig::default());

        attach_sync_metadata(&mut config, &stored).unwrap();
        assert_eq!(config.cloud_version, Some(15));

        std::env::remove_var("CLOUD_VERSION_PATH");
    }
}

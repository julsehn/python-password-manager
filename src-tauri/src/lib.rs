#![deny(warnings)]

#[allow(dead_code)]
mod railway;
#[allow(dead_code)]
mod security;
#[allow(dead_code)]
pub mod server;
pub mod vault;

use railway::{decide_sync_action, SyncAction, SyncAutoResponse, SyncConfig, SyncResponse};
use serde::{Deserialize, Serialize};
use server::ServerState;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use vault::visible_trash;

// Tests in this module and in `railway` mutate process-wide environment
// variables (`VAULT_PATH`, `CLOUD_VERSION_PATH`, ...). They must share one
// lock or Cargo's parallel test runner can observe another test's value.
#[cfg(test)]
pub(crate) static TEST_ENV_LOCK: Mutex<()> = Mutex::new(());

use sha2::{Digest, Sha256};
pub use vault::{
    CloudSession, Entry, Folder, HistoryItem, TrashedEntry, VaultData, VaultInfo, VaultState,
};
use zeroize::Zeroizing;

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

pub(crate) fn ui_preferences_path() -> PathBuf {
    config_dir().join("ui_preferences.json")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct UiPreferences {
    font_size: u8,
}

fn clamp_ui_font_size(size: u8) -> u8 {
    size.clamp(14, 24)
}

#[tauri::command]
fn get_ui_font_size() -> Result<Option<u8>, String> {
    let path = ui_preferences_path();
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("No s'ha pogut llegir la configuració: {}", error)),
    };
    let preferences: UiPreferences = match serde_json::from_str(&raw) {
        Ok(preferences) => preferences,
        Err(_) => return Ok(None),
    };
    Ok(Some(clamp_ui_font_size(preferences.font_size)))
}

#[tauri::command]
fn set_ui_font_size(size: u8) -> Result<(), String> {
    if !(14..=24).contains(&size) {
        return Err("La mida del text ha d'estar entre 14 i 24 px.".to_string());
    }
    let preferences = UiPreferences { font_size: size };
    let contents = serde_json::to_vec(&preferences)
        .map_err(|error| format!("No s'ha pogut serialitzar la configuració: {}", error))?;
    atomic_write(&ui_preferences_path(), &contents)
}

pub(crate) const MIN_MASTER_PASSWORD_LENGTH: usize = 12;

/// The frontend shows the same checklist, but the backend is authoritative:
/// never encrypt a vault with a master password that does not meet it.
pub(crate) fn validate_master_password(password: &str) -> Result<(), String> {
    let invalid = || -> Result<(), String> {
        Err(format!(
            "La contrasenya mestra ha de tenir com a mínim {} caràcters i incloure majúscules, minúscules, números i un caràcter especial.",
            MIN_MASTER_PASSWORD_LENGTH
        ))
    };
    if password.chars().count() < MIN_MASTER_PASSWORD_LENGTH {
        return invalid();
    }
    if !password
        .chars()
        .any(|character| character.is_ascii_uppercase())
        || !password
            .chars()
            .any(|character| character.is_ascii_lowercase())
        || !password.chars().any(|character| character.is_ascii_digit())
        || !password
            .chars()
            .any(|character| !character.is_ascii_alphanumeric() && !character.is_whitespace())
    {
        return invalid();
    }
    Ok(())
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

pub(crate) fn cloud_hash_path() -> PathBuf {
    std::env::var_os("CLOUD_HASH_PATH")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| config_dir().join("cloud_hash"))
}

pub(crate) fn store_cloud_hash(hash: &str) -> Result<(), String> {
    atomic_write(&cloud_hash_path(), hash.as_bytes())
}

pub(crate) fn load_cloud_hash() -> Option<String> {
    let path = cloud_hash_path();
    if path.exists() {
        std::fs::read_to_string(path).ok()
    } else {
        None
    }
}

pub(crate) fn delete_cloud_hash() {
    let path = cloud_hash_path();
    let _ = std::fs::remove_file(path);
}

pub(crate) fn current_vault_hash() -> Option<String> {
    let vault_path = vault_path();
    if !vault_path.exists() {
        return None;
    }
    let content = std::fs::read(&vault_path).ok()?;
    Some(sha256_hex(&content))
}

/// Store the hash of the local file as it exists now. Downloads re-encrypt the
/// vault when they save the cloud session, so hashing the downloaded blob
/// would make the next auto-sync think the local copy changed.
fn store_current_vault_hash() {
    if let Some(hash) = current_vault_hash() {
        let _ = store_cloud_hash(&hash);
    }
}

fn sha256_hex(content: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content);
    let result = hasher.finalize();
    format!("{:x}", result)
}

fn attach_sync_metadata(
    config: &mut SyncConfig,
    stored_config: &Mutex<SyncConfig>,
    server_state: &ServerState,
) -> Result<(), String> {
    let vault_session = server_state
        .unlocked_data
        .lock()
        .map_err(|_| "Failed to access unlocked vault".to_string())?
        .as_ref()
        .and_then(|vault| vault.cloud_session.clone());

    if let Some(session) = vault_session {
        let matches = (config.vault_id.is_empty() || config.vault_id == session.vault_id)
            && (config.railway_url.is_empty()
                || normalized_cloud_url(&config.railway_url) == session.railway_url);
        if matches {
            config.railway_url.clone_from(&session.railway_url);
            config.vault_id.clone_from(&session.vault_id);
            config.token.clone_from(&session.access_token);
            config.refresh_token.clone_from(&session.refresh_token);
        }
    }

    if config.refresh_token.is_empty() {
        let stored = stored_config
            .lock()
            .map_err(|_| "Failed to access Railway configuration".to_string())?;
        if stored.vault_id == config.vault_id
            && normalized_cloud_url(&stored.railway_url)
                == normalized_cloud_url(&config.railway_url)
            && !stored.refresh_token.is_empty()
        {
            config.token.clone_from(&stored.token);
            config.refresh_token.clone_from(&stored.refresh_token);
        }
    }

    if !config.refresh_token.is_empty() {
        if let Ok(mut stored) = stored_config.lock() {
            stored.railway_url.clone_from(&config.railway_url);
            stored.vault_id.clone_from(&config.vault_id);
            stored.token.clone_from(&config.token);
            stored.refresh_token.clone_from(&config.refresh_token);
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

fn persist_cloud_session(session: &CloudSession, server_state: &ServerState) -> Result<(), String> {
    let (master_password, data) = {
        let unlocked = server_state
            .unlocked_data
            .lock()
            .map_err(|_| "Failed to access unlocked vault".to_string())?;
        let vault = unlocked
            .as_ref()
            .ok_or_else(|| "Vault must be unlocked to save cloud credentials".to_string())?;
        (
            vault.master_password.clone(),
            VaultData {
                entries: vault.entries.clone(),
                folders: vault.folders.clone(),
                deleted_entries: vault.trash.clone(),
                history: vault.history.clone(),
                cloud_session: Some(session.clone()),
            },
        )
    };
    server::save_vault_data(&master_password, &data)?;
    server_state.set_unlocked_with_cloud_session(
        master_password.to_string(),
        data.entries,
        data.folders,
        data.deleted_entries,
        data.history,
        data.cloud_session,
    );
    Ok(())
}

fn remove_vault_cloud_session(server_state: &ServerState) -> Result<(), String> {
    let (master_password, mut data) = {
        let unlocked = server_state
            .unlocked_data
            .lock()
            .map_err(|_| "Failed to access unlocked vault".to_string())?;
        let vault = unlocked
            .as_ref()
            .ok_or_else(|| "Vault must be unlocked to remove cloud credentials".to_string())?;
        (
            vault.master_password.clone(),
            VaultData {
                entries: vault.entries.clone(),
                folders: vault.folders.clone(),
                deleted_entries: vault.trash.clone(),
                history: vault.history.clone(),
                cloud_session: None,
            },
        )
    };
    data.cloud_session = None;
    server::save_vault_data(&master_password, &data)?;
    server_state.set_unlocked(
        master_password.to_string(),
        data.entries,
        data.folders,
        data.deleted_entries,
        data.history,
    );
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

#[derive(Debug, Serialize)]
struct CloudAuthSummary {
    username: String,
    vault_id: String,
}

fn cloud_session_from_config(config: &SyncConfig) -> CloudSession {
    CloudSession {
        railway_url: normalized_cloud_url(&config.railway_url),
        vault_id: config.vault_id.clone(),
        access_token: config.token.clone(),
        refresh_token: config.refresh_token.clone(),
    }
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
    let vault_file: VaultFile = serde_json::from_str(content).map_err(|e| {
        format!(
            "No s'ha pogut interpretar l'estructura de la caixa forta: {}",
            e
        )
    })?;
    if vault_file.version != VAULT_FORMAT_VERSION {
        return Err(format!(
            "Versió de caixa forta no compatible: '{}' (s'esperava '{}').",
            vault_file.version, VAULT_FORMAT_VERSION
        ));
    }
    let salt = security::decode_base64(&vault_file.salt, "salt")?;
    if salt.len() != 16 {
        return Err("La sal de la caixa forta té una longitud no vàlida".to_string());
    }
    let nonce = security::decode_base64(&vault_file.nonce, "nonce")?;
    if nonce.len() != 12 {
        return Err("El nonce de la caixa forta té una longitud no vàlida".to_string());
    }
    let ciphertext = security::decode_base64(&vault_file.ciphertext, "ciphertext")?;
    if ciphertext.len() < 17 {
        return Err("El text xifrat de la caixa forta és massa curt".to_string());
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
            change_master_password,
            save_vault,
            reset_vault,
            lock_vault,
            hide_main_window,
            get_vault_info,
            get_vault_entries,
            get_ui_font_size,
            set_ui_font_size,
            update_entry,
            sync_upload_vault,
            sync_download_vault,
            sync_vault_auto,
            sync_resolve_conflict,
            auth_official_cloud,
            register_official_cloud,
            cloud_password_matches_master,
            check_railway_username,
            revoke_official_cloud_session,
            delete_cloud_account,
            set_railway_sync_config,
            get_cloud_version,
            generate_pairing_code,
            list_paired_clients,
            revoke_paired_client,
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
) -> Result<VaultState, String> {
    println!("Creating new vault...");
    validate_master_password(&password)?;
    let password = Zeroizing::new(password);

    if vault_path().exists() {
        return Err(
            "Ja existeix una caixa forta en aquest dispositiu; no se n'ha creat una de nova."
                .to_string(),
        );
    }

    let vault_data = VaultData {
        entries: vec![],
        folders: vec![],
        deleted_entries: vec![],
        history: vec![],
        cloud_session: None,
    };

    let data =
        serde_json::to_string(&vault_data).map_err(|e| format!("Failed to serialize: {}", e))?;

    let salt = security::generate_salt().map_err(|e| format!("Failed to generate salt: {}", e))?;

    let key = security::derive_key_from_password(&password, &salt)
        .map_err(|e| format!("No s'ha pogut derivar la clau: {}", e))?;

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

    Ok(VaultState {
        is_new: true,
        entries: vec![],
        folders: vec![],
        trash: vec![],
        history: vec![],
    })
}

fn remove_legacy_image_auth_files() -> Result<(), String> {
    for file_name in [
        "grid_auth.json",
        "image_auth_secret.json",
        "image_auth.json",
    ] {
        let path = config_dir().join(file_name);
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|error| format!("Failed to remove local auth data: {}", error))?;
        }
    }
    Ok(())
}

#[tauri::command]
fn reset_vault(server_state: tauri::State<'_, Arc<ServerState>>) -> Result<(), String> {
    let vault_path = vault_path();
    if vault_path.exists() {
        std::fs::remove_file(&vault_path)
            .map_err(|error| format!("Failed to remove local vault: {}", error))?;
    }
    remove_legacy_image_auth_files()?;
    server::remove_paired_clients()?;
    delete_cloud_version();
    delete_cloud_hash();

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
        return Err(
            "No hi ha cap caixa forta local; crea'n una de nova des de la pantalla de benvinguda."
                .to_string(),
        );
    }

    let content = std::fs::read_to_string(&vault_path)
        .map_err(|e| format!("Failed to read vault file: {}", e))?;

    let vault_file = parse_vault_file(&content)?;

    let salt_bytes = security::decode_base64(&vault_file.salt, "salt")?;
    let key = security::derive_key_from_password(&master_password, &salt_bytes)
        .map_err(|e| format!("No s'ha pogut derivar la clau de la contrasenya: {}", e))?;

    let nonce_bytes = security::decode_base64(&vault_file.nonce, "nonce")?;
    let ciphertext_bytes = security::decode_base64(&vault_file.ciphertext, "ciphertext")?;

    let decrypted = security::decrypt_aes_gcm(&key, &nonce_bytes, &ciphertext_bytes)
        .map_err(|_| {
            "No s'ha pogut desxifrar la caixa forta. Comprova que la contrasenya mestra sigui correcta.".to_string()
        })?;

    let data: String = String::from_utf8_lossy(&decrypted).into();
    let vault_data: VaultData = serde_json::from_str(&data).map_err(|e| {
        format!(
            "No s'ha pogut interpretar les dades desxifrades de la caixa forta: {}",
            e
        )
    })?;

    server_state.set_unlocked_with_cloud_session(
        master_password.to_string(),
        vault_data.entries.clone(),
        vault_data.folders.clone(),
        vault_data.deleted_entries.clone(),
        vault_data.history.clone(),
        vault_data.cloud_session.clone(),
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

/// Re-encrypt the existing vault with a new master password, preserving all
/// entries, folders, trash, history, and the cloud session.
#[tauri::command]
fn change_master_password(
    new_password: String,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<(), String> {
    validate_master_password(&new_password)?;
    let new_password = Zeroizing::new(new_password);
    let current_password = {
        let unlocked = server_state
            .unlocked_data
            .lock()
            .map_err(|_| "No s'ha pogut accedir a la caixa forta desbloquejada".to_string())?;
        unlocked
            .as_ref()
            .ok_or_else(|| "La caixa forta està bloquejada".to_string())?
            .master_password
            .clone()
    };

    let vault_path = vault_path();
    let old_content = std::fs::read_to_string(&vault_path)
        .map_err(|error| format!("No s'ha pogut llegir la caixa forta xifrada: {}", error))?;
    let old_vault = parse_vault_file(&old_content)?;
    let old_salt = security::decode_base64(&old_vault.salt, "salt")?;
    let old_key = security::derive_key_from_password(&current_password, &old_salt)?;
    let old_nonce = security::decode_base64(&old_vault.nonce, "nonce")?;
    let old_ciphertext = security::decode_base64(&old_vault.ciphertext, "ciphertext")?;
    let plaintext = security::decrypt_aes_gcm(&old_key, &old_nonce, &old_ciphertext)
        .map_err(|error| format!("No s'ha pogut desxifrar la caixa forta existent: {}", error))?;
    let vault_data: VaultData = serde_json::from_slice(&plaintext).map_err(|error| {
        format!(
            "No s'ha pogut interpretar la caixa forta existent: {}",
            error
        )
    })?;

    let new_salt = security::generate_salt()
        .map_err(|error| format!("No s'ha pogut generar el salt: {}", error))?;
    let new_key = security::derive_key_from_password(&new_password, &new_salt)?;
    let new_nonce = security::generate_nonce()
        .map_err(|error| format!("No s'ha pogut generar el nonce: {}", error))?;
    let new_plaintext = serde_json::to_vec(&vault_data)
        .map_err(|error| format!("No s'ha pogut serialitzar la caixa forta: {}", error))?;
    let new_ciphertext = security::encrypt_aes_gcm(&new_key, &new_nonce, &new_plaintext)?;
    let payload = serde_json::json!({
        "salt": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &new_salt),
        "nonce": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &new_nonce),
        "ciphertext": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &new_ciphertext),
        "version": "1"
    });
    atomic_write(&vault_path, payload.to_string().as_bytes())?;

    server_state.set_unlocked_with_cloud_session(
        new_password.to_string(),
        vault_data.entries,
        vault_data.folders,
        vault_data.deleted_entries,
        vault_data.history,
        vault_data.cloud_session,
    );
    Ok(())
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
    let (master_password, cloud_session) = {
        let unlocked = server_state
            .unlocked_data
            .lock()
            .map_err(|_| "Failed to access unlocked vault".to_string())?;
        let vault = unlocked
            .as_ref()
            .ok_or_else(|| "Vault is locked".to_string())?;
        (vault.master_password.clone(), vault.cloud_session.clone())
    };

    let vault_data = VaultData {
        entries,
        folders,
        deleted_entries: trash,
        history,
        cloud_session,
    };

    if master_password.is_empty() {
        return Err("Master password cannot be empty".to_string());
    }

    let data =
        serde_json::to_string(&vault_data).map_err(|e| format!("Failed to serialize: {}", e))?;

    let salt = security::generate_salt().map_err(|e| format!("Failed to generate salt: {}", e))?;

    let key = security::derive_key_from_password(&master_password, &salt)
        .map_err(|e| format!("No s'ha pogut derivar la clau: {}", e))?;

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

    server_state.set_unlocked_with_cloud_session(
        master_password.to_string(),
        vault_data.entries.clone(),
        vault_data.folders.clone(),
        vault_data.deleted_entries.clone(),
        vault_data.history.clone(),
        vault_data.cloud_session.clone(),
    );

    println!("Vault saved successfully");

    if sync_to_railway {
        let mut config = sync_state
            .lock()
            .map_err(|_| "Failed to access Railway configuration".to_string())?
            .clone();
        attach_sync_metadata(&mut config, &sync_state, &server_state)?;

        if !config.railway_url.is_empty()
            && !config.vault_id.is_empty()
            && !config.refresh_token.is_empty()
        {
            println!("Syncing vault to Railway...");
            let (_response, version, hash) =
                do_upload_vault(&config, &server_state).await.map_err(|e| {
                    format!(
                        "Railway sync failed: {}. Vault saved locally but not synced.",
                        e
                    )
                })?;
            let _ = store_cloud_version(version);
            let _ = store_cloud_hash(&hash);
            if let Ok(mut sync_config) = sync_state.lock() {
                sync_config.cloud_version = Some(version);
            }
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
            cloud_session: vault.cloud_session.clone(),
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
    server_state.set_unlocked_with_cloud_session(
        master_password.to_string(),
        vault_data.entries.clone(),
        vault_data.folders.clone(),
        vault_data.deleted_entries.clone(),
        vault_data.history.clone(),
        vault_data.cloud_session.clone(),
    );

    Ok(updated_entry)
}

#[tauri::command]
/// Lògica interna de pujada (sense gestió de sync_state), reutilitzada per
/// `sync_upload_vault` i `sync_vault_auto`.
async fn do_upload_vault(
    config: &SyncConfig,
    server_state: &Arc<ServerState>,
) -> Result<(SyncResponse, i64, String), String> {
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
        .map_err(|e| format!("No s'ha pogut derivar la clau: {}", e))?;

    let nonce_bytes = security::decode_base64(&vault_file.nonce, "nonce")?;
    let ciphertext_bytes = security::decode_base64(&vault_file.ciphertext, "ciphertext")?;

    let decrypted = security::decrypt_aes_gcm(&key, &nonce_bytes, &ciphertext_bytes)
        .map_err(|_| {
            "No s'ha pogut desxifrar la caixa forta. Comprova que la contrasenya mestra sigui correcta.".to_string()
        })?;

    let _data: String = String::from_utf8_lossy(&decrypted).into();

    let hash = sha256_hex(content.as_bytes());

    // Never overwrite a cloud vault whose version this device has not seen.
    // The server also refuses unconditional updates, but checking here keeps
    // the error actionable and avoids an unnecessary request.
    let upload_config = config.clone();
    if upload_config.cloud_version.is_none()
        && railway::remote_vault_version(&upload_config)
            .await?
            .is_some()
    {
        return Err(
            "La caixa al núvol ja existeix en aquest compte. Descarrega-la abans de pujar-hi res."
                .to_string(),
        );
    }

    match railway::upload_vault(&upload_config).await? {
        railway::UploadResult::Ok(response, version) => Ok((response, version, hash)),
        railway::UploadResult::Conflict => Err(
            "La caixa al núvol és més nova que la local. Descarregueu-la abans de tornar a pujar."
                .to_string(),
        ),
    }
}

#[tauri::command]
async fn sync_upload_vault(
    mut config: SyncConfig,
    sync_state: tauri::State<'_, Mutex<SyncConfig>>,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<SyncResponse, String> {
    attach_sync_metadata(&mut config, &sync_state, &server_state)?;
    let (response, version, hash) = do_upload_vault(&config, &server_state).await?;
    let _ = store_cloud_version(version);
    let _ = store_cloud_hash(&hash);
    if let Ok(mut sync_config) = sync_state.lock() {
        sync_config.cloud_version = Some(version);
    }
    Ok(response)
}

#[tauri::command]
/// Lògica interna de baixada (sense gestió de sync_state), reutilitzada per
/// `sync_download_vault`, `sync_vault_auto` i `sync_resolve_conflict`.
async fn do_download_vault(
    master_password: &Zeroizing<String>,
    config: &SyncConfig,
    server_state: &Arc<ServerState>,
) -> Result<(String, i64, String), String> {
    let (blob, remote_version) =
        railway::download_vault(master_password.to_string(), config).await?;

    let vault_file = parse_vault_file(&blob)?;

    let salt_bytes = security::decode_base64(&vault_file.salt, "salt")?;
    let key = security::derive_key_from_password(master_password, &salt_bytes)
        .map_err(|e| format!("No s'ha pogut derivar la clau: {}", e))?;

    let nonce_bytes = security::decode_base64(&vault_file.nonce, "nonce")?;
    let ciphertext_bytes = security::decode_base64(&vault_file.ciphertext, "ciphertext")?;

    let decrypted = security::decrypt_aes_gcm(&key, &nonce_bytes, &ciphertext_bytes)
        .map_err(|_| {
            "No s'ha pogut desxifrar la caixa forta descarregada. Comprova que la contrasenya mestra sigui correcta.".to_string()
        })?;

    let data: String = String::from_utf8_lossy(&decrypted).into();
    let vault_data: VaultData = serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse decrypted vault: {}", e))?;

    // Safely update the local vault file only now.
    let vault_path = vault_path();

    if vault_path.exists() {
        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S_%f");
        let backup_path = vault_path.with_extension(format!("{}.bak", timestamp));
        std::fs::copy(&vault_path, &backup_path)
            .map_err(|e| format!("Failed to back up local vault before sync: {}", e))?;
    }

    atomic_write(&vault_path, blob.as_bytes())?;

    server_state.set_unlocked_with_cloud_session(
        master_password.to_string(),
        vault_data.entries.clone(),
        vault_data.folders.clone(),
        vault_data.deleted_entries.clone(),
        vault_data.history.clone(),
        vault_data.cloud_session.clone(),
    );

    let json = serde_json::to_string(&vault_data)
        .map_err(|e| format!("Failed to serialize vault: {}", e))?;
    let hash = sha256_hex(blob.as_bytes());
    Ok((json, remote_version, hash))
}

#[tauri::command]
async fn sync_download_vault(
    master_password: Option<String>,
    mut config: SyncConfig,
    sync_state: tauri::State<'_, Mutex<SyncConfig>>,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<String, String> {
    attach_sync_metadata(&mut config, &sync_state, &server_state)?;
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
    let (json, remote_version, _hash) =
        do_download_vault(&master_password, &config, &server_state).await?;
    persist_cloud_session(&cloud_session_from_config(&config), &server_state)?;

    let _ = store_cloud_version(remote_version);
    store_current_vault_hash();
    if let Ok(mut sync_config) = sync_state.lock() {
        sync_config.cloud_version = Some(remote_version);
    }

    Ok(json)
}

#[tauri::command]
async fn sync_vault_auto(
    mut config: SyncConfig,
    sync_state: tauri::State<'_, Mutex<SyncConfig>>,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<SyncAutoResponse, String> {
    attach_sync_metadata(&mut config, &sync_state, &server_state)?;

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

    let known_version = {
        let sc = sync_state
            .lock()
            .map_err(|_| "Failed to access sync config".to_string())?;
        sc.cloud_version.or_else(load_cloud_version)
    };

    let local_changed = match load_cloud_hash() {
        None => true,
        Some(saved) => current_vault_hash() != Some(saved),
    };

    let remote_version = railway::remote_vault_version(&config).await?;
    let action = decide_sync_action(local_changed, known_version, remote_version);

    let now = chrono::Utc::now().timestamp() as u64;
    let mk = |outcome: &str, message: &str, version: Option<i64>| SyncAutoResponse {
        outcome: outcome.to_string(),
        message: message.to_string(),
        timestamp: now,
        error: None,
        version,
    };

    match action {
        SyncAction::UpToDate => Ok(mk("up_to_date", "La caixa ja està al día amb el núbol.", known_version)),
        SyncAction::Upload => {
            let (sync_response, version, hash) = do_upload_vault(&config, &server_state).await?;
            let _ = store_cloud_version(version);
            let _ = store_cloud_hash(&hash);
            if let Ok(mut sc) = sync_state.lock() {
                sc.cloud_version = Some(version);
            }
            Ok(mk("uploaded", &sync_response.message, Some(version)))
        }
        SyncAction::Download => {
            let mp = Zeroizing::new(master_password);
            let (_json, remote_version, hash) =
                do_download_vault(&mp, &config, &server_state).await?;
            persist_cloud_session(&cloud_session_from_config(&config), &server_state)?;
                    let _ = store_cloud_version(remote_version);
            let _ = store_cloud_hash(&hash);
            if let Ok(mut sc) = sync_state.lock() {
                sc.cloud_version = Some(remote_version);
            }
            Ok(mk("downloaded", "Caixa descarregada del núbol.", Some(remote_version)))
        }
        SyncAction::Conflict => Ok(mk("conflict", "Conflicte: la caixa local i al núbol tenen canvis no reconciliats. No s'ha sobreescrit res.", None)),
    }
}

#[tauri::command]
async fn sync_resolve_conflict(
    _config: SyncConfig,
    keep: String,
    mut sync_config_arg: SyncConfig,
    sync_state: tauri::State<'_, Mutex<SyncConfig>>,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<SyncAutoResponse, String> {
    attach_sync_metadata(&mut sync_config_arg, &sync_state, &server_state)?;

    let now = chrono::Utc::now().timestamp() as u64;
    let mk = |outcome: &str, message: &str, version: Option<i64>| SyncAutoResponse {
        outcome: outcome.to_string(),
        message: message.to_string(),
        timestamp: now,
        error: None,
        version,
    };

    match keep.as_str() {
        "cloud" => {
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
            let mp = Zeroizing::new(master_password);
            let (_json, remote_version, hash) =
                do_download_vault(&mp, &sync_config_arg, &server_state).await?;
            persist_cloud_session(&cloud_session_from_config(&sync_config_arg), &server_state)?;
            let _ = store_cloud_version(remote_version);
            let _ = store_cloud_hash(&hash);
            if let Ok(mut sc) = sync_state.lock() {
                sc.cloud_version = Some(remote_version);
            }
            Ok(mk(
                "downloaded",
                "Caixa del núbol restaurada.",
                Some(remote_version),
            ))
        }
        "local" => {
            let remote_version = railway::remote_vault_version(&sync_config_arg)
                .await?
                .ok_or_else(|| "El núbol no té caixa on pujar".to_string())?;
            let mut config_for_upload = sync_config_arg.clone();
            config_for_upload.cloud_version = Some(remote_version);
            match do_upload_vault(&config_for_upload, &server_state).await {
                Ok((sync_response, version, hash)) => {
                    let _ = store_cloud_version(version);
                    let _ = store_cloud_hash(&hash);
                    if let Ok(mut sc) = sync_state.lock() {
                        sc.cloud_version = Some(version);
                    }
                    Ok(mk("uploaded", &sync_response.message, Some(version)))
                }
                Err(err) if err.contains("més nova que la local") => Ok(mk(
                    "conflict",
                    "Conflicte: el núbol ha canviat mentrestant. Torneu a provar.",
                    None,
                )),
                Err(err) => Err(err),
            }
        }
        _ => Err(format!("Valor de resolució no vàlid: {keep}")),
    }
}

#[tauri::command]
async fn auth_official_cloud(
    username: String,
    password: String,
    railway_url: Option<String>,
    for_download: bool,
    state: tauri::State<'_, Mutex<SyncConfig>>,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<CloudAuthSummary, String> {
    if !server_state.is_unlocked() && !for_download {
        return Err("Desbloqueja la caixa forta per desar la sessió de Railway.".to_string());
    }

    let mut auth = railway::auth_user(&username, &password, railway_url.as_deref()).await?;
    let refresh_token = std::mem::take(&mut auth.refresh_token);
    let url = normalized_cloud_url(railway_url.as_deref().unwrap_or_default());
    if refresh_token.is_empty() {
        return Err("El servei del núvol no ha retornat un token de sessió.".to_string());
    }
    let runtime_config = SyncConfig {
        railway_url: url.clone(),
        vault_id: auth.vault_id.clone(),
        token: auth.access_token.clone(),
        refresh_token: refresh_token.clone(),
        cloud_version: load_cloud_version(),
    };
    let session = cloud_session_from_config(&runtime_config);
    if server_state.is_unlocked() {
        persist_cloud_session(&session, &server_state)?;
    }
    let mut config = state
        .lock()
        .map_err(|_| "Failed to access Railway configuration".to_string())?;
    *config = runtime_config;
    Ok(CloudAuthSummary {
        username: auth.username,
        vault_id: auth.vault_id,
    })
}

#[tauri::command]
async fn register_official_cloud(
    username: String,
    password: String,
    railway_url: Option<String>,
    state: tauri::State<'_, Mutex<SyncConfig>>,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<CloudAuthSummary, String> {
    if !server_state.is_unlocked() {
        return Err("Desbloqueja la caixa forta per desar la sessió de Railway.".to_string());
    }

    if validate_master_password(&password).is_err() {
        return Err(
            "La contrasenya de Railway ha de tenir com a mínim 12 caràcters i incloure majúscules, minúscules, números i un caràcter especial."
                .to_string(),
        );
    }

    if server_state.master_password_matches(&password) {
        return Err(
            "La contrasenya de Railway no pot ser la mateixa que la contrasenya mestra de la caixa forta. Tria'n una de diferent."
                .to_string(),
        );
    }

    let mut auth = railway::register_user(&username, &password, railway_url.as_deref()).await?;
    let refresh_token = std::mem::take(&mut auth.refresh_token);
    let url = normalized_cloud_url(railway_url.as_deref().unwrap_or_default());
    if refresh_token.is_empty() {
        return Err("El servei del núvol no ha retornat un token de sessió.".to_string());
    }
    let runtime_config = SyncConfig {
        railway_url: url.clone(),
        vault_id: auth.vault_id.clone(),
        token: auth.access_token.clone(),
        refresh_token: refresh_token.clone(),
        cloud_version: load_cloud_version(),
    };
    let session = cloud_session_from_config(&runtime_config);
    persist_cloud_session(&session, &server_state)?;
    let mut config = state
        .lock()
        .map_err(|_| "Failed to access Railway configuration".to_string())?;
    *config = runtime_config;
    Ok(CloudAuthSummary {
        username: auth.username,
        vault_id: auth.vault_id,
    })
}

/// Check a candidate Railway password against the unlocked vault master
/// password. The master password never leaves Rust; only the boolean result
/// is returned so the registration form can warn before submitting.
#[tauri::command]
fn cloud_password_matches_master(
    password: String,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> bool {
    server_state.master_password_matches(&password)
}

#[tauri::command]
async fn check_railway_username(
    username: String,
    railway_url: Option<String>,
) -> Result<bool, String> {
    railway::check_username_availability(&username, railway_url.as_deref()).await
}

fn clear_local_cloud_state(
    state: &Mutex<SyncConfig>,
    server_state: &ServerState,
) -> Result<(), String> {
    remove_vault_cloud_session(server_state)?;
    delete_cloud_version();
    delete_cloud_hash();
    if let Ok(mut config) = state.lock() {
        config.token.clear();
        config.refresh_token.clear();
        config.vault_id.clear();
        config.railway_url.clear();
        config.cloud_version = None;
    }
    Ok(())
}

#[tauri::command]
async fn revoke_official_cloud_session(
    railway_url: String,
    vault_id: String,
    token: Option<String>,
    state: tauri::State<'_, Mutex<SyncConfig>>,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<(), String> {
    let mut config = state
        .lock()
        .map_err(|_| "Failed to access Railway configuration".to_string())?
        .clone();
    config.railway_url = normalized_cloud_url(&railway_url);
    config.vault_id = vault_id;
    if let Some(token) = token {
        config.token = token;
    }

    attach_sync_metadata(&mut config, &state, &server_state)?;

    let result = if config.refresh_token.is_empty() {
        Ok(())
    } else {
        railway::revoke_refresh_token(&config).await
    };
    clear_local_cloud_state(&state, &server_state)?;
    result
}

/// Elimina el vault al nuvol, el compte d'usuari i neteja l'estat local.
#[tauri::command]
async fn delete_cloud_account(
    master_password: String,
    config: SyncConfig,
    state: tauri::State<'_, Mutex<SyncConfig>>,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<(), String> {
    let mut config = config;
    attach_sync_metadata(&mut config, &state, &server_state)?;

    // 1. Eliminar el vault xifrat al nuvol (404 és acceptable: potser mai no s'ha pujat)
    let _ = railway::delete_vault(master_password.clone(), &config).await;
    // 2. Eliminar el compte d'usuari al servidor (tots els seus vaults + perfil)
    railway::delete_user_account(&config).await?;
    // 3. Revocar la sessió (refresh token) si n'hi ha una (best-effort)
    let _ = railway::revoke_refresh_token(&config).await;

    // 4. Netejar l'estat local de cloud (mateixa lògica que revoke_official_cloud_session)
    clear_local_cloud_state(&state, &server_state)?;
    Ok(())
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
    use crate::TEST_ENV_LOCK as SYNC_ENV_LOCK;

    #[test]
    fn invalid_downloaded_blob_fails_validation() {
        let corrupt_blob = "not a valid json blob";
        let parse_result = serde_json::from_str::<VaultFile>(corrupt_blob);
        assert!(parse_result.is_err());
    }

    #[test]
    fn decryption_failure_message_is_localized_and_hides_aead_details() {
        let salt = vec![1u8; 16];
        let key = security::derive_key_from_password("correct_password", &salt).unwrap();
        let nonce = security::generate_nonce().unwrap();
        let ciphertext = security::encrypt_aes_gcm(&key, &nonce, b"payload").unwrap();
        let wrong_key = security::derive_key_from_password("wrong_password", &salt).unwrap();

        let message = security::decrypt_aes_gcm(&wrong_key, &nonce, &ciphertext).unwrap_err();
        assert_eq!(message, security::DECRYPTION_FAILED);
        assert!(message.contains("No s'ha pogut desxifrar"));
        assert!(!message.contains("aead::Error"));
        assert!(!message.to_ascii_lowercase().contains("decryption failed"));
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
        let server_state = ServerState::new();

        attach_sync_metadata(&mut config, &stored, &server_state).unwrap();
        assert_eq!(config.cloud_version, Some(15));

        std::env::remove_var("CLOUD_VERSION_PATH");
    }

    #[test]
    fn persist_cloud_session_encrypts_tokens_in_the_vault() {
        let _guard = SYNC_ENV_LOCK.lock().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("vault.json");
        std::env::set_var("VAULT_PATH", &path);

        let server_state = ServerState::new();
        server_state.set_unlocked(
            "master-password".to_string(),
            vec![],
            vec![],
            vec![],
            vec![],
        );
        let session = CloudSession {
            railway_url: "https://example.test".to_string(),
            vault_id: "vault-1".to_string(),
            access_token: "access-secret".to_string(),
            refresh_token: "refresh-secret".to_string(),
        };

        persist_cloud_session(&session, &server_state).unwrap();

        let encrypted_file = std::fs::read_to_string(&path).unwrap();
        assert!(!encrypted_file.contains("access-secret"));
        assert!(!encrypted_file.contains("refresh-secret"));

        let vault_file = parse_vault_file(&encrypted_file).unwrap();
        let salt = security::decode_base64(&vault_file.salt, "salt").unwrap();
        let key = security::derive_key_from_password("master-password", &salt).unwrap();
        let nonce = security::decode_base64(&vault_file.nonce, "nonce").unwrap();
        let ciphertext = security::decode_base64(&vault_file.ciphertext, "ciphertext").unwrap();
        let plaintext = security::decrypt_aes_gcm(&key, &nonce, &ciphertext).unwrap();
        let data: VaultData = serde_json::from_slice(&plaintext).unwrap();
        let stored_session = data.cloud_session.unwrap();

        assert_eq!(stored_session.access_token, "access-secret");
        assert_eq!(stored_session.refresh_token, "refresh-secret");

        let mut config = SyncConfig {
            railway_url: "https://example.test".to_string(),
            vault_id: "vault-1".to_string(),
            ..SyncConfig::default()
        };
        attach_sync_metadata(
            &mut config,
            &Mutex::new(SyncConfig::default()),
            &server_state,
        )
        .unwrap();
        assert_eq!(config.token, "access-secret");
        assert_eq!(config.refresh_token, "refresh-secret");
        std::env::remove_var("VAULT_PATH");
    }

    #[test]
    fn cloud_hash_stores_and_loads_correctly() {
        let _guard = SYNC_ENV_LOCK.lock().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("cloud_hash");
        std::env::set_var("CLOUD_HASH_PATH", &path);

        assert_eq!(load_cloud_hash(), None);
        store_cloud_hash("deadbeef").unwrap();
        assert_eq!(load_cloud_hash(), Some("deadbeef".to_string()));

        delete_cloud_hash();
        assert_eq!(load_cloud_hash(), None);

        std::env::remove_var("CLOUD_HASH_PATH");
    }

    #[test]
    fn sha256_hex_is_deterministic_and_sensitive() {
        let a = sha256_hex(b"hello world");
        let b = sha256_hex(b"hello world");
        let c = sha256_hex(b"hello world!");
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.len(), 64); // SHA-256 = 64 hex caràcters
    }

    #[test]
    fn current_vault_hash_reflects_file_content() {
        let _guard = SYNC_ENV_LOCK.lock().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let vault_path = directory.path().join("vault.json");
        std::env::set_var("VAULT_PATH", &vault_path);

        std::fs::write(&vault_path, b"content-a").unwrap();
        let h1 = current_vault_hash().unwrap();
        assert!(!h1.is_empty());

        std::fs::write(&vault_path, b"content-a").unwrap();
        assert_eq!(current_vault_hash(), Some(h1.clone()));

        std::fs::write(&vault_path, b"content-b").unwrap();
        assert_ne!(current_vault_hash(), Some(h1));

        std::fs::remove_file(&vault_path).unwrap();
        assert_eq!(current_vault_hash(), None);

        std::env::remove_var("VAULT_PATH");
    }
}

#[cfg(test)]
mod master_password_tests {
    use super::validate_master_password;

    #[test]
    fn accepts_a_password_with_length_and_every_character_class() {
        assert!(validate_master_password("Abcdefghij1!x").is_ok());
    }

    #[test]
    fn rejects_short_or_incomplete_passwords() {
        assert!(validate_master_password("Abcdefgh1!x").is_err());
        assert!(validate_master_password("abcdefghij1!x").is_err());
        assert!(validate_master_password("ABCDEFGHIJ1!X").is_err());
        assert!(validate_master_password("Abcdefghijk!x").is_err());
        assert!(validate_master_password("Abcdefghij12x").is_err());
        assert!(validate_master_password("Abcdefghij1 ").is_err());
    }
}

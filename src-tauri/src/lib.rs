use aes_gcm::{aead::{Aead, KeyInit}, Aes256Gcm, Key, Nonce};
use argon2::{Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use zeroize::Zeroize;

const VAULT_VERSION: u8 = 1;
const ASSOCIATED_DATA: &[u8] = b"caixa-forta-v1";

mod commands {
use super::*;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub site: String,
    pub username: String,
    pub password: String,
    pub notes: String,
    #[serde(default)]
    pub folder_id: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultResult {
    pub entries: Vec<Entry>,
    pub history: Vec<Generation>,
    #[serde(default)]
    pub trash: Vec<Entry>,
    #[serde(default)]
    pub folders: Vec<Folder>,
    pub is_new: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Generation {
    pub id: String,
    pub r#type: String,
    pub value: String,
    pub language: String,
    pub created_at: String,
}

#[derive(Deserialize, Serialize)]
struct VaultData {
    entries: Vec<Entry>,
    #[serde(default)]
    history: Vec<Generation>,
    #[serde(default)]
    trash: Vec<Entry>,
    #[serde(default)]
    folders: Vec<Folder>,
}

#[derive(Deserialize, Serialize)]
struct EncryptedVault {
    version: u8,
    salt: String,
    nonce: String,
    ciphertext: String,
}

pub struct VaultState {
    master_password: Mutex<Option<String>>,
}

impl Default for VaultState {
    fn default() -> Self {
        Self { master_password: Mutex::new(None) }
    }
}

impl Drop for VaultState {
    fn drop(&mut self) {
        if let Ok(mut stored) = self.master_password.lock() {
            if let Some(mut password) = stored.take() {
                password.zeroize();
            }
        }
    }
}

fn remember_master(state: &State<'_, VaultState>, password: String) -> Result<(), String> {
    let mut stored = state.master_password.lock().map_err(|_| "Estado del vault bloqueado".to_string())?;
    if let Some(mut old_password) = stored.take() {
        old_password.zeroize();
    }
    *stored = Some(password);
    Ok(())
}

fn vault_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    std::fs::set_permissions(&dir, std::os::unix::fs::PermissionsExt::from_mode(0o700)).map_err(|error| error.to_string())?;
    Ok(dir.join("vault.json"))
}

fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let params = Params::new(19 * 1024, 2, 1, Some(32)).map_err(|error| error.to_string())?;
    let argon = Argon2::new(argon2::Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon.hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|error| error.to_string())?;
    Ok(key)
}

fn validate_entries(entries: &[Entry]) -> Result<(), String> {
    if entries.len() > 10_000 {
        return Err("El vault supera el límite de entradas permitido".into());
    }
    for entry in entries {
        if entry.site.len() > 4_096 || entry.username.len() > 4_096 || entry.password.len() > 16_384 || entry.notes.len() > 32_768 || entry.folder_id.len() > 128 {
            return Err("Una entrada supera el tamaño permitido".into());
        }
    }
    Ok(())
}

fn validate_folders(folders: &[Folder]) -> Result<(), String> {
    if folders.len() > 100 || folders.iter().any(|folder| folder.id.len() > 128 || folder.name.is_empty() || folder.name.len() > 80 || folder.icon.len() > 32 || folder.color.len() > 16) {
        return Err("Les carpetes no són vàlides".into());
    }
    Ok(())
}

fn validate_master_password(password: &str) -> Result<(), String> {
    if password.len() < 12 {
        return Err("La contraseña maestra debe tener al menos 12 caracteres".into());
    }
    Ok(())
}

fn persist_vault(app: &AppHandle, entries: Vec<Entry>, history: Vec<Generation>, trash_entries: Vec<Entry>, folders: Vec<Folder>, master_password: &str) -> Result<(), String> {
    validate_entries(&entries)?;
    validate_entries(&trash_entries)?;
    validate_folders(&folders)?;
    if history.len() > 50 || history.iter().any(|item| item.value.len() > 512) {
        return Err("L'historial de generacions no és vàlid".into());
    }
    let plaintext = serde_json::to_vec(&VaultData { entries, history, trash: trash_entries, folders }).map_err(|error| error.to_string())?;
    let mut salt = [0u8; 16];
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce_bytes);
    let mut key_bytes = derive_key(master_password, &salt)?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));
    let encryption_result = cipher.encrypt(Nonce::from_slice(&nonce_bytes), aes_gcm::aead::Payload { msg: &plaintext, aad: ASSOCIATED_DATA });
    key_bytes.zeroize();
    let ciphertext = encryption_result.map_err(|error| error.to_string())?;
    let payload = EncryptedVault {
        version: VAULT_VERSION,
        salt: BASE64.encode(salt),
        nonce: BASE64.encode(nonce_bytes),
        ciphertext: BASE64.encode(ciphertext),
    };
    let path = vault_path(app)?;
    let temp_path = path.with_extension("json.tmp");
    let encoded = serde_json::to_vec_pretty(&payload).map_err(|error| error.to_string())?;
    let mut temp_file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&temp_path)
        .map_err(|error| error.to_string())?;
    #[cfg(unix)]
    std::fs::set_permissions(&temp_path, std::os::unix::fs::PermissionsExt::from_mode(0o600)).map_err(|error| error.to_string())?;
    temp_file.write_all(&encoded).map_err(|error| error.to_string())?;
    temp_file.sync_all().map_err(|error| error.to_string())?;
    drop(temp_file);
    std::fs::rename(&temp_path, &path).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    std::fs::set_permissions(&path, std::os::unix::fs::PermissionsExt::from_mode(0o600)).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn unlock_vault(app: AppHandle, state: State<'_, VaultState>, mut master_password: String) -> Result<VaultResult, String> {
    let result = (|| {
    validate_master_password(&master_password)?;
    let path = vault_path(&app)?;
    if !path.exists() {
        remember_master(&state, master_password.clone())?;
        return Ok(VaultResult { entries: Vec::new(), history: Vec::new(), trash: Vec::new(), folders: Vec::new(), is_new: true });
    }
    #[cfg(unix)]
    std::fs::set_permissions(&path, std::os::unix::fs::PermissionsExt::from_mode(0o600)).map_err(|error| error.to_string())?;
    let raw = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let payload: EncryptedVault = serde_json::from_str(&raw).map_err(|_| "El vault está dañado".to_string())?;
    if payload.version != VAULT_VERSION {
        return Err("Versión de vault no compatible".into());
    }
    let salt = BASE64.decode(payload.salt).map_err(|_| "Salt inválido".to_string())?;
    let nonce = BASE64.decode(payload.nonce).map_err(|_| "Nonce inválido".to_string())?;
    let ciphertext = BASE64.decode(payload.ciphertext).map_err(|_| "Cifrado inválido".to_string())?;
    if salt.len() != 16 || nonce.len() != 12 {
        return Err("Formato de vault inválido".into());
    }
    let mut key_bytes = derive_key(&master_password, &salt)?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));
    let decryption_result = cipher.decrypt(Nonce::from_slice(&nonce), aes_gcm::aead::Payload { msg: &ciphertext, aad: ASSOCIATED_DATA });
    key_bytes.zeroize();
    let plaintext = decryption_result.map_err(|_| "Contraseña maestra incorrecta o vault dañado".to_string())?;
    let data: VaultData = serde_json::from_slice(&plaintext).or_else(|_| {
        serde_json::from_slice::<Vec<Entry>>(&plaintext).map(|entries| VaultData { entries, history: Vec::new(), trash: Vec::new(), folders: Vec::new() })
    }).map_err(|_| "Contenido del vault inválido".to_string())?;
    let entries = data.entries;
    validate_entries(&entries)?;
    validate_entries(&data.trash)?;
    validate_folders(&data.folders)?;
    if data.history.len() > 50 || data.history.iter().any(|item| item.value.len() > 512) {
        return Err("L'historial de generacions no és vàlid".into());
    }
    remember_master(&state, master_password.clone())?;
    Ok(VaultResult { entries, history: data.history, trash: data.trash, folders: data.folders, is_new: false })
    })();
    master_password.zeroize();
    result
}

#[tauri::command]
pub fn save_vault(app: AppHandle, state: State<'_, VaultState>, entries: Vec<Entry>, history: Vec<Generation>, trash: Option<Vec<Entry>>, folders: Option<Vec<Folder>>) -> Result<(), String> {
    let trash_entries = trash.unwrap_or_default();
    let folders = folders.unwrap_or_default();
    let stored = state.master_password.lock().map_err(|_| "Estado del vault bloqueado".to_string())?;
    let master_password = stored.as_ref().ok_or_else(|| "El vault está bloqueado".to_string())?;
    persist_vault(&app, entries, history, trash_entries, folders, master_password)
}

#[tauri::command]
pub fn change_master_password(app: AppHandle, state: State<'_, VaultState>, mut current_password: String, mut new_password: String, entries: Vec<Entry>, history: Vec<Generation>, trash: Vec<Entry>, folders: Vec<Folder>) -> Result<(), String> {
    let result = (|| {
        validate_master_password(&new_password)?;
        let mut stored = state.master_password.lock().map_err(|_| "Estado del vault bloqueado".to_string())?;
        let remembered_password = stored.as_ref().ok_or_else(|| "El vault está bloqueado".to_string())?;
        if remembered_password != &current_password {
            return Err("La contrasenya mestra actual no és correcta".into());
        }
        persist_vault(&app, entries, history, trash, folders, &new_password)?;
        if let Some(mut old_password) = stored.replace(new_password.clone()) {
            old_password.zeroize();
        }
        Ok(())
    })();
    current_password.zeroize();
    new_password.zeroize();
    result
}

#[tauri::command]
pub fn lock_vault(state: State<'_, VaultState>) -> Result<(), String> {
    let mut stored = state.master_password.lock().map_err(|_| "Estado del vault bloqueado".to_string())?;
    if let Some(mut password) = stored.take() {
        password.zeroize();
    }
    Ok(())
}

#[tauri::command]
pub fn app_info() -> &'static str {
    "Caixa forta local segura"
}
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(commands::VaultState::default())
        .invoke_handler(tauri::generate_handler![commands::app_info, commands::unlock_vault, commands::save_vault, commands::change_master_password, commands::lock_vault])
        .run(tauri::generate_context!())
        .expect("error while running Caixa forta");
}

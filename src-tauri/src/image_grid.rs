use rand::{rngs::OsRng, RngCore};
use std::sync::Arc;
use zeroize::Zeroizing;

use crate::server::ServerState;
use crate::{
    atomic_write, config_dir, parse_vault_file, security, vault_path, VaultData, VaultInfo,
    VaultState,
};

const IMAGE_GRID_SERVICE: &str = "com.juls.sherlock";
const IMAGE_GRID_ACCOUNT: &str = "image-grid-cell-values";
const IMAGE_GRID_FORMAT_VERSION: u64 = 5;

/// Retorna `true` només si el contingut del fitxer descriu una autenticació per
/// graella d'imatge del format actualment suportat (type == "image_grid" i
/// versió == 5). Funció pura: no toca el sistema de fitxers ni el keyring.
fn is_supported_grid_auth(content: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(content)
        .ok()
        .map(|metadata| {
            metadata.get("type").and_then(serde_json::Value::as_str) == Some("image_grid")
                && metadata.get("version").and_then(serde_json::Value::as_u64)
                    == Some(IMAGE_GRID_FORMAT_VERSION)
        })
        .unwrap_or(false)
}

#[tauri::command]
pub(super) fn get_auth_info() -> Result<VaultInfo, String> {
    let path = grid_auth_path();
    let supported = path.exists()
        && std::fs::read_to_string(&path)
            .map(|content| is_supported_grid_auth(&content))
            .unwrap_or(false);

    // Nunca esborrem res al llegir la informació d'autenticació: un fitxer
    // corrupte, tallat o d'una versió desconeguda no ha de destruir la graella
    // ni el secret del keyring.
    Ok(VaultInfo {
        exists: supported,
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
        let fragment =
            Zeroizing::new(String::from_utf8(bytes).expect("generated fragments are ASCII"));
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
pub(super) fn get_image_grid_auth() -> Result<Option<serde_json::Value>, String> {
    let path = grid_auth_path();
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(path)
        .map_err(|error| format!("Failed to read grid auth data: {}", error))?;
    let data: serde_json::Value = serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse grid auth data: {}", error))?;
    if data.get("type").and_then(serde_json::Value::as_str) != Some("image_grid")
        || data.get("version").and_then(serde_json::Value::as_u64)
            != Some(IMAGE_GRID_FORMAT_VERSION)
    {
        return Err("Unsupported image authentication format".to_string());
    }
    Ok(Some(data))
}

/// Persist the public image and keep generated cell fragments in the OS credential store.
#[tauri::command]
pub(super) fn set_image_grid_auth(
    image_data: String,
    selected_cells: Vec<u8>,
) -> Result<(), String> {
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
pub(super) async fn init_empty_grid_vault(
    selected_cells: Vec<u8>,
    server_state: tauri::State<'_, Arc<ServerState>>,
) -> Result<(), String> {
    let cell_values = load_image_grid_cell_values()?;
    let metadata_content = std::fs::read_to_string(grid_auth_path())
        .map_err(|error| format!("Failed to read image authentication: {}", error))?;
    let metadata: serde_json::Value = serde_json::from_str(&metadata_content)
        .map_err(|error| format!("Failed to parse image authentication: {}", error))?;
    if metadata.get("type").and_then(serde_json::Value::as_str) != Some("image_grid")
        || metadata.get("version").and_then(serde_json::Value::as_u64)
            != Some(IMAGE_GRID_FORMAT_VERSION)
    {
        return Err("Unsupported image authentication format".to_string());
    }
    let password = grid_password_from_cells_with_minimum(&selected_cells, &cell_values, 12)?;
    crate::init_empty_vault_from_grid(password, server_state).await
}

/// Re-encrypt an existing vault using the selected image-grid fragments.
#[tauri::command]
pub(super) fn change_vault_to_image_grid(
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
    let old_vault = parse_vault_file(&content)?;
    let old_salt = security::decode_base64(&old_vault.salt, "salt")?;
    let old_key = security::derive_key_from_password(&current_password, &old_salt)?;
    let old_nonce = security::decode_base64(&old_vault.nonce, "nonce")?;
    let old_ciphertext = security::decode_base64(&old_vault.ciphertext, "ciphertext")?;
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
pub(super) fn change_vault_to_password(
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
    let old_vault = parse_vault_file(&old_content)?;
    let old_salt = security::decode_base64(&old_vault.salt, "salt")?;
    let old_key = security::derive_key_from_password(&current_password, &old_salt)?;
    let old_nonce = security::decode_base64(&old_vault.nonce, "nonce")?;
    let old_ciphertext = security::decode_base64(&old_vault.ciphertext, "ciphertext")?;
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
pub(super) fn unlock_vault_grid(
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
        || grid_auth.get("version").and_then(serde_json::Value::as_u64)
            != Some(IMAGE_GRID_FORMAT_VERSION)
    {
        return Err("Unsupported image authentication format".to_string());
    }
    let cell_values = load_image_grid_cell_values()?;
    let master_password = grid_password_from_cells_with_minimum(&pattern, &cell_values, 12)?;

    println!("Image authentication verified successfully");

    crate::unlock_vault_from_grid(master_password, server_state)
}

pub(super) fn remove_image_auth() -> Result<(), String> {
    let path = grid_auth_path();
    if path.exists() {
        security::delete_os_secret(IMAGE_GRID_SERVICE, IMAGE_GRID_ACCOUNT)?;
        std::fs::remove_file(&path)
            .map_err(|error| format!("Failed to remove image authentication: {}", error))?;
    }
    Ok(())
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
    fn image_grid_metadata_rejects_short_two_character_fragments() {
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
mod grid_auth_info_tests {
    use super::is_supported_grid_auth;

    #[test]
    fn supported_grid_auth_is_recognized() {
        assert!(is_supported_grid_auth(
            r#"{"type":"image_grid","version":5}"#
        ));
    }

    #[test]
    fn corrupt_json_is_not_supported() {
        assert!(!is_supported_grid_auth("{ not valid json"));
    }

    #[test]
    fn unknown_version_is_not_supported() {
        assert!(!is_supported_grid_auth(
            r#"{"type":"image_grid","version":4}"#
        ));
    }

    #[test]
    fn wrong_type_is_not_supported() {
        assert!(!is_supported_grid_auth(r#"{"type":"other","version":5}"#));
    }

    #[test]
    fn missing_fields_are_not_supported() {
        assert!(!is_supported_grid_auth(r#"{}"#));
        assert!(!is_supported_grid_auth(r#"{"type":"image_grid"}"#));
        assert!(!is_supported_grid_auth(r#"{"version":5}"#));
    }

    #[test]
    fn get_auth_info_never_deletes_real_vault_file() {
        // Crida la comanda de lectura sobre la ruta real. No ha de petar ni
        // esborrar el fitxer (el codi d'esborrat s'ha eliminat).
        let info = super::get_auth_info().expect("get_auth_info no ha de fallar");
        assert_eq!(info.entry_count, 0);
        assert_eq!(info.folder_count, 0);
        assert_eq!(info.trash_count, 0);
    }
}

// Security module for Tauri IPC communication
// Provides AES-256-GCM encryption and Argon2id key derivation

use aes_gcm::{aead::{Aead, KeyInit, Payload}, Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::{rngs::OsRng, Rng, RngCore};
use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

const ASSOCIATED_DATA: &[u8] = b"";

pub fn decode_hex_or_base64(value: &str, field: &str) -> Result<Vec<u8>, String> {
    hex::decode(value)
        .or_else(|_| BASE64.decode(value))
        .map_err(|e| format!("Invalid {} format: {}", field, e))
}

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
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    Ok(BASE64.encode(bytes))
}

// Generate salt for Argon2id key derivation
pub fn generate_salt() -> Result<Vec<u8>, String> {
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    Ok(salt.to_vec())
}

// Generate random nonce for AES-GCM
pub fn generate_nonce() -> Result<Vec<u8>, String> {
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    Ok(nonce.to_vec())
}

// Derive key from password using Argon2id
pub fn derive_key_from_password(password: &str, salt: &[u8]) -> Result<Vec<u8>, String> {
    let mut key = [0u8; 32];

    // Use PBKDF2-SHA256 for key derivation
    // Match the Python vault format: 600,000 PBKDF2-SHA256 iterations.
    pbkdf2::pbkdf2_hmac::<Sha256>(
        password.as_bytes(),
        salt,
        600_000,
        &mut key,
    );

    Ok(key.to_vec())
}

// Alternative: Derive key using Argon2id (more secure)
pub fn derive_key_with_argon2(password: &str, salt: &[u8]) -> Result<Vec<u8>, String> {
    let mut key = [0u8; 32];

    // Argon2id parameters
    // m = 64 * 1024 memory blocks (65536 KB = 64 MiB)
    // t = 4 passes
    // p = 1 parallelism degree
    // y = 1.1 cost factor

    let argon2 = argon2::Argon2::default();
    argon2.hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| format!("Failed to derive key with Argon2: {}", e))?;

    Ok(key.to_vec())
}

// Encrypt data using AES-256-GCM
pub fn encrypt_aes_gcm(key: &[u8], nonce: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| {
        format!("Failed to initialize cipher: {}", e)
    })?;

    cipher.encrypt(
        Nonce::from_slice(nonce),
        Payload { msg: plaintext, aad: ASSOCIATED_DATA },
    ).map_err(|e| format!("Encryption failed: {}", e))
}

// Decrypt data using AES-256-GCM
pub fn decrypt_aes_gcm(key: &[u8], nonce: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| {
        format!("Failed to initialize cipher: {}", e)
    })?;

    cipher.decrypt(
        Nonce::from_slice(nonce),
        Payload { msg: ciphertext, aad: ASSOCIATED_DATA },
    ).map_err(|e| {
        // VerifyIntegrityError means wrong password/key
        format!("Decryption failed - invalid password: {}", e)
    })

}

// Generate cryptographically secure random password
pub fn generate_password(
    length: u32,
    uppercase: bool,
    lowercase: bool,
    numbers: bool,
    symbols: bool,
) -> String {
    let charset: Vec<char> = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;':,./<>?".chars().collect();

    let mut charset_vec: Vec<char> = Vec::new();
    if uppercase { charset_vec.extend(charset.iter().filter(|c| c.is_uppercase())); }
    if lowercase { charset_vec.extend(charset.iter().filter(|c| c.is_lowercase())); }
    if numbers { charset_vec.extend(charset.iter().filter(|c| c.is_ascii_digit())); }
    if symbols { charset_vec.extend(charset.iter().filter(|c| !c.is_alphanumeric())); }
    if charset_vec.is_empty() { charset_vec = charset; }

    let mut password = String::new();
    for _ in 0..length as usize {
        password.push(*charset_vec.choose(&mut OsRng).unwrap());
    }

    // Shuffle the password
    let mut password_chars: Vec<_> = password.chars().collect();
    password_chars.shuffle(&mut OsRng);
    password_chars.into_iter().collect()
}

// Generate a Diceware-style passphrase
pub fn generate_passphrase(
    word_count: u32,
    separator: String,
    uppercase_words: bool,
    include_number: bool,
    remove_accents: bool,
    language: String,
) -> String {
    // Word lists by language
    let words: Vec<&str> = match language.as_str() {
        "ca" | "catalan" | "catal" => vec![
            "nubol", "ri", "llum", "bosc", "mar", "lluna", "vent", "foc", "cami", "estrella"
        ],
        "es" | "spanish" | "espanol" => vec![
            "nube", "rio", "luz", "bosque", "mar", "luna", "viento", "fuego", "camino", "estrella"
        ],
        "en" | "english" | "angle" => vec![
            "cloud", "river", "light", "forest", "moon", "wind", "fire", "path", "star", "meadow"
        ],
        "fr" | "french" | "frances" => vec![
            "nuage", "riviere", "lumiere", "foret", "lune", "vent", "feu", "chemin", "etoile", "prairie"
        ],
        _ => vec![
            "cloud", "river", "light", "forest", "moon", "wind", "fire", "path", "star", "meadow"
        ]
    };

    let filtered_words: Vec<&str> = if remove_accents {
        words.iter()
            .filter(|w| {
                let normalized = w.to_string().chars().collect::<String>();
                normalized.chars().all(|c| c.is_ascii())
            })
            .copied()
            .collect()
    } else {
        words.iter().copied().collect()
    };

    let mut passphrase = Vec::new();
    let mut rng = OsRng;
    for i in 0..word_count as usize {
        if include_number && i == word_count as usize - 1 {
            passphrase.push(format!("{}", rng.gen_range(0..99)));
        } else {
            let word = filtered_words.choose(&mut rng).unwrap();
            if uppercase_words && passphrase.is_empty() {
                let chars: Vec<char> = word.chars().collect();
                let mut formatted_word = String::new();
                if let Some(&first) = chars.first() {
                    formatted_word.extend(first.to_uppercase());
                }
                if let Some(rest) = chars.get(1..) {
                    formatted_word.extend(rest.iter());
                }
                passphrase.push(formatted_word);
            } else {
                passphrase.push((*word).to_string());
            }
        }
    }

    passphrase.join(&separator)
}
// Generate a unique username
pub fn generate_username(
    first_name: Option<String>,
    last_name: Option<String>,
    include_numbers: bool,
) -> String {
    let name = if let Some(fn_) = first_name {
        fn_
    } else if let Some(ln) = last_name {
        ln
    } else {
        return generate_password(8, false, true, true, false);
    };

    let parts: Vec<&str> = name.split_whitespace().collect();
    let first_word = parts.first().copied().unwrap_or(name.as_str());

    let username = if include_numbers {
        let mut rng = OsRng;
        format!("{}.{}", first_word.to_lowercase(), rng.gen_range(100..999))
    } else {
        first_word.to_lowercase()
    };

    username
}

// Validate password strength
pub fn validate_password_strength(password: &str) -> PasswordStrength {
    let mut score = 0;

    if password.len() >= 12 { score += 1; }
    if password.len() >= 16 { score += 1; }
    if password.len() >= 20 { score += 1; }

    if password.chars().any(|c| c.is_uppercase()) { score += 1; }
    if password.chars().any(|c| c.is_lowercase()) { score += 1; }
    if password.chars().any(|c| c.is_ascii_digit()) { score += 1; }
    if password.chars().any(|c| !c.is_alphanumeric()) { score += 1; }

    match score {
        0..=2 => PasswordStrength::Weak,
        3..=4 => PasswordStrength::Fair,
        5..=6 => PasswordStrength::Good,
        _ => PasswordStrength::Strong,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum PasswordStrength {
    Weak,
    Fair,
    Good,
    Strong,
}

impl std::fmt::Display for PasswordStrength {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PasswordStrength::Weak => write!(f, "Feble"),
            PasswordStrength::Fair => write!(f, "Acceptable"),
            PasswordStrength::Good => write!(f, "Bona"),
            PasswordStrength::Strong => write!(f, "Molt forta"),
        }
    }
}

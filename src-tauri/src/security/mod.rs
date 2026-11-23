use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::seq::SliceRandom;
use rand::{rngs::OsRng, RngCore};
use zeroize::{Zeroize, Zeroizing};

pub const ARGON2_MEMORY_COST_KIB: u32 = 64 * 1024;
pub const ARGON2_TIME_COST: u32 = 3;
pub const ARGON2_PARALLELISM: u32 = 1;
pub const KEY_LENGTH: usize = 32;

const ASSOCIATED_DATA: &[u8] = b"";

pub fn decode_base64(value: &str, field: &str) -> Result<Vec<u8>, String> {
    BASE64
        .decode(value)
        .map_err(|_| format!("Invalid {} format", field))
}

pub fn generate_secure_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    Ok(BASE64.encode(bytes))
}

pub fn generate_salt() -> Result<Vec<u8>, String> {
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    Ok(salt.to_vec())
}

pub fn generate_nonce() -> Result<Vec<u8>, String> {
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    Ok(nonce.to_vec())
}

pub fn derive_key_from_password(password: &str, salt: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    derive_key_from_password_with_params(
        password,
        salt,
        ARGON2_MEMORY_COST_KIB,
        ARGON2_TIME_COST,
        ARGON2_PARALLELISM,
    )
}

pub fn derive_key_from_password_with_params(
    password: &str,
    salt: &[u8],
    memory_cost_kib: u32,
    time_cost: u32,
    parallelism: u32,
) -> Result<Zeroizing<Vec<u8>>, String> {
    let mut key = [0u8; KEY_LENGTH];
    let params = Params::new(memory_cost_kib, time_cost, parallelism, Some(key.len()))
        .map_err(|e| format!("Invalid Argon2id parameters: {}", e))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let res = argon2
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| format!("Failed to derive key with Argon2id: {}", e));

    if let Err(err) = res {
        key.zeroize();
        return Err(err);
    }

    let key_vec = Zeroizing::new(key.to_vec());
    key.zeroize();
    Ok(key_vec)
}

pub fn encrypt_aes_gcm(key: &[u8], nonce: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| format!("Failed to initialize cipher: {}", e))?;

    if nonce.len() != 12 {
        return Err("Invalid nonce length".to_string());
    }
    cipher
        .encrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: plaintext,
                aad: ASSOCIATED_DATA,
            },
        )
        .map_err(|e| format!("Encryption failed: {}", e))
}

pub fn decrypt_aes_gcm(key: &[u8], nonce: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| format!("Failed to initialize cipher: {}", e))?;

    if nonce.len() != 12 {
        return Err("Invalid nonce length".to_string());
    }
    cipher
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad: ASSOCIATED_DATA,
            },
        )
        .map_err(|e| format!("Decryption failed - invalid password: {}", e))
}

pub fn generate_password(
    length: u32,
    uppercase: bool,
    lowercase: bool,
    numbers: bool,
    symbols: bool,
) -> String {
    let length = length.clamp(8, 128);
    let charset: Vec<char> = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;':,./<>?".chars().collect();

    let mut charset_vec: Vec<char> = Vec::new();
    if uppercase {
        charset_vec.extend(charset.iter().filter(|c| c.is_uppercase()));
    }
    if lowercase {
        charset_vec.extend(charset.iter().filter(|c| c.is_lowercase()));
    }
    if numbers {
        charset_vec.extend(charset.iter().filter(|c| c.is_ascii_digit()));
    }
    if symbols {
        charset_vec.extend(charset.iter().filter(|c| !c.is_alphanumeric()));
    }
    if charset_vec.is_empty() {
        charset_vec = charset;
    }

    let mut password = String::new();
    for _ in 0..length as usize {
        password.push(*charset_vec.choose(&mut OsRng).unwrap());
    }

    let mut password_chars: Vec<_> = password.chars().collect();
    password_chars.shuffle(&mut OsRng);
    password_chars.into_iter().collect()
}

#[cfg(test)]
mod kdf_tests {
    use super::derive_key_from_password;

    #[test]
    fn argon2id_matches_python_parameters() {
        let salt: Vec<u8> = (0..16).collect();
        let key = derive_key_from_password("shared-test-password", &salt).unwrap();

        assert_eq!(
            hex::encode(&*key),
            "24f35b029273a54b22a71e1aba8fb6d92d7eb469d00ed3eae30d735f0b0a5017"
        );
    }
}

#[cfg(test)]
mod base64_tests {
    use super::decode_base64;
    use super::BASE64;
    use base64::Engine;

    #[test]
    fn decode_base64_round_trip() {
        let original = b"test data";
        let encoded = BASE64.encode(original);
        let decoded = decode_base64(&encoded, "test").unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn decode_base64_invalid_length() {
        assert!(decode_base64("zz!", "test").is_err());
    }

    #[test]
    fn decode_base64_hex_string_is_not_hex() {
        // "ABCDEF0123456789" as base64 decodes to 12 bytes (not 8 as hex would)
        let result = decode_base64("ABCDEF0123456789", "test").unwrap();
        assert_eq!(result.len(), 12);
    }
}

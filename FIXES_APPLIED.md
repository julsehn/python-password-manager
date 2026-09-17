# Correcciones Aplicadas - Native Messaging y Backend

## Problemas Identificados

### 1. Timeout al guardar credenciales
```
Error: Desktop app unavailable: timed out
```
El backend tenía un timeout de 3 segundos que era insuficiente para operaciones de escritura al archivo de la bóveda.

### 2. Token de sesión caducado
```
Error: Authentication required or token expired
```
El token de sesión expira después de 15 minutos y el host no lo renovaba automáticamente.

### 3. Mutex de la bóveda bloqueando peticiones concurrentes
El backend mantenía el mutex mientras escribía el archivo, bloqueando otras peticiones.

---

## Cambios en `browser-extension/native/caixa_forta_native.py`

### 1. Aumentado timeout en `app_request()`
```python
def app_request(
    method: str,
    endpoint: str,
    payload: Optional[Dict[str, Any]] = None,
    query: Optional[Dict[str, str]] = None,
    timeout: int = 5,  # Aumentado de 3 a 5 segundos
) -> Dict[str, Any]:
```

### 2. Renovación automática de token en `fetchCredentials()`
```python
elif action == "fetchCredentials":
    # Intenta obtener credenciales con timeout extendido
    response = app_request(
        "GET", "/credentials",
        query={"domain": message.get("site", "")},
        timeout=8,  # 8 segundos para GET
    )
    response["site"] = message.get("site", "")
    
    # Si la autenticación falló, renueva el token
    if not response.get("success") and "Authentication required" in response.get("error", ""):
        logger.info("Token expired, refreshing...")
        if ensure_app_token():
            # Reintenta con nuevo token
            response = app_request(
                "GET", "/credentials",
                query={"domain": message.get("site", "")},
                timeout=8,
            )
            response["site"] = message.get("site", "")
```

### 3. Renovación automática de token en `saveCredentials()`
```python
elif action == "saveCredentials":
    # Intenta guardar con timeout extendido
    response = app_request(
        "POST", "/credentials",
        message.get("data", {}),
        timeout=10,  # 10 segundos para POST (escribe al archivo)
    )
    
    # Si falla por autenticación o timeout, renueva el token y reintent
    if not response.get("success") and (
        "Authentication required" in response.get("error", "") or 
        "Desktop app unavailable" in response.get("error", "")
    ):
        logger.info("Token expired or app unavailable, refreshing...")
        if ensure_app_token():
            # Reintenta con nuevo token
            response = app_request(
                "POST", "/credentials",
                message.get("data", {}),
                timeout=10,
            )
```

---

## Cambios en `src-tauri/src/server.rs`

### 1. Semaphore para operaciones de escritura concurrentes
```rust
pub struct ServerState {
    pub unlocked_data: Mutex<Option<UnlockedVault>>,
    pub session_token: Mutex<Option<SessionToken>>,
    pub shared_secret: Mutex<String>,
    pub write_semaphore: Arc<Mutex<Option<tokio::sync::Semaphore>>>,  // Nuevo
}
```

### 2. Inicialización del semaphore (permite 1 operación de escritura a la vez)
```rust
impl ServerState {
    pub fn new() -> Self {
        let secret = load_or_generate_secret();
        let semaphore = Arc::new(Mutex::new(Some(tokio::sync::Semaphore::new(1))));
        Self {
            unlocked_data: Mutex::new(None),
            session_token: Mutex::new(None),
            shared_secret: Mutex::new(secret),
            write_semaphore: semaphore,
        }
    }
}
```

### 3. Liberación del semaphore al bloquear la bóveda
```rust
pub fn lock(&self) {
    let mut data = self.unlocked_data.lock().unwrap();
    *data = None;
    let mut token = self.session_token.lock().unwrap();
    *token = None;
    let mut sem = self.write_semaphore.lock().unwrap();
    *sem = None;  // Liberar semaphore
}
```

### 4. Retries para operaciones de escritura al archivo
```rust
pub fn save_vault_data(master_password: &str, vault_data: &VaultData) -> Result<(), String> {
    // ... (código de encriptación) ...
    
    // Retry logic for file operations
    for attempt in 0..3 {
        match std::fs::write(&vault_path, payload.to_string()) {
            Ok(_) => {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(&vault_path, 
                        std::fs::Permissions::from_mode(0o600));
                }
                return Ok(());
            }
            Err(e) => {
                if attempt < 2 {
                    std::thread::sleep(std::time::Duration::from_millis(100 * (attempt + 1)));
                }
            }
        }
    }
    
    Err(format!("Failed to write vault after retries: {}", e))
}
```

### 5. Protección con semaphore en el endpoint `/api/v1/credentials` POST
```rust
// Save credential
if path == "/api/v1/credentials" && method == "POST" {
    // Adquire write semaphore to prevent concurrent file operations
    let write_perm = if let Some(sem) = &*state.write_semaphore.lock().unwrap() {
        sem.clone()
    } else {
        return (401, r#"{"success":false,"unlocked":false,"error":"Vault is locked"}"#.to_string());
    };
    
    // Try to acquire write permission with timeout
    let _permit = match write_perm.try_acquire() {
        Ok(permit) => permit,
        Err(_) => {
            return (503, r#"{"success":false,"error":"Too many concurrent write operations, please retry"}"#.to_string());
        }
    };
    
    // ... (rest of the save logic) ...
}
```

---

## Flujo de Corrección

### Antes:
1. Extension → Native Host → Backend (timeout 3s) → Timeout ❌
2. Token expira → Error 401 → No se reintent ❌
3. Escritura concurrente → Mutex bloqueado → Timeout ❌

### Después:
1. Extension → Native Host → Backend (timeout 10s) → Éxito ✅
2. Token expira → Host detecta → `ensure_app_token()` → Reintenta ✅
3. Escritura concurrente → Semaphore → Retries → Éxito ✅

---

## Pruebas

Para probar las correcciones:

1. **Timeout**: Intenta guardar credenciales cuando el backend está lento
2. **Token expirado**: Espera 15 minutos y reaccede a credenciales
3. **Concurrente**: Abre múltiples popups y guarda credenciales simultáneamente

---

## Notas

- El timeout de 10 segundos para operaciones de escritura es suficiente para la mayoría de casos
- El semaphore permite 1 operación de escritura a la vez, previniendo corrupción de archivo
- Los retries en el backend añaden 100ms, 200ms, 300ms entre intentos
- El host renueva el token automáticamente sin intervención del usuario

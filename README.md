# SherLock - Password Manager

Una aplicació de gestió de contrasenyes de codi obert per a Mac, Windows i Linux construïda amb Tauri, Rust i Vite.

![SherLock](https://img.shields.io/badge/License-MIT-yellow.svg)
![Rust](https://img.shields.io/badge/Rust-Tauri-orange)

## Característiques

- 🔐 **Criptografia end-a-end**: Totes les dades s'encifren localment amb AES-256-GCM i derivació de claus Argon2id (64 MiB, 3 passades)
- ☁️ **Sync a la núvol**: Sync automàtic amb Railway API
- 🔒 **Protecció de memòria**: Neteja de memòria amb `zeroize` per a dades sensibles
- 📱 **Interfície d'escriptori**: Aplicació nativa lleugera amb Tauri 2
- 🎯 **Autocompliment**: Omple automàticament formularis amb contrasenyes
- 🔋 **Bloqueig automàtic**: La SherLock es bloqueja per inactivitat
- 🌐 **Extensió del navegador**: Chrome i Firefox amb missatgeria nativa

## Requeriments

- Node.js 18+
- Rust & Cargo
- Python 3.10+ (per al Native Messaging Host de l'extensió)

Per generar una versió macOS signada i notaritzada, executa `npm run tauri:build:macos:release` amb `APPLE_SIGNING_IDENTITY`, `APPLE_API_ISSUER`, `APPLE_API_KEY` i `APPLE_API_KEY_PATH` configurats. L'ordre s'atura si no troba una identitat de codi-signatura vàlida.

## Instal·lació

### 1. Clona el repositori

```bash
git clone https://github.com/julsehn/Password-Manager-Cloud.git
cd password-manager-cloud
```

### 2. Crea un entorn virtual

```bash
python -m venv .venv
source .venv/bin/activate  # Linux/Mac
# o
.venv\Scripts\activate  # Windows
```

### 3. Instala les dependències

```bash
pip install -r requirements.txt
```

### 4. Comença a desenvolupar

SherLock és una aplicació Tauri (Rust + JS vanilla), no una app PyQt. Per executar-la en desenvolupament:

**macOS:** fes doble clic a `Obrir_SherLock.command` o executa:

```bash
./Obrir_SherLock.command
```

**Qualsevol plataforma:**

```bash
npm run tauri dev
```

## Configuració del Servei a la Núvol

Per utilitzar la funció de sync a la núvol:

1. **Desplega la API a Railway**:
   - Vés a https://railway.app
   - Crea un nou projecte
   - Connecta aquest repositori
   - Desplega

2. **Configura l'URL del servei**:
   - Ves a l'apartat "Configuració" a l'aplicació
   - Introdueix l'URL del teu servei Railway
   - Crea una nova SherLock núvol (obté un vault_id i token)

3. **Sincronització**:
   - Pujar o descarregar la SherLock des del menú "Remot"

### Configuració Manual

Si prefereixes configurar manualment, crea o edita el fitxer `~/.password_manager/config.json`:

```json
{
  "railway_url": "https://el-teu-servici.up.railway.app",
  "railway_vault_id": "el-teu-vault-id",
  "railway_token": "el-teu-token"
}
```

## Estructura del Projecte

```
python-password-manager/
├── browser-extension/      # Extensió del navegador (Chrome/Firefox)
│   ├── manifest.chrome.json # Manifest font de Chrome
│   ├── manifest.firefox.json # Manifest font de Firefox
│   ├── build/              # Paquets generats per build.sh
│   ├── background.js       # Service worker
│   ├── popup.html          # UI de l'extensió
│   ├── popup.js            # Controlador de l'extensió
│   ├── content.js          # Script de contingut per autofill
│   ├── content.css         # Estils de contingut
│   ├── native_messaging_host.py  # Host de missatgeria nativa
│   ├── native_messaging_host_wrapper.sh  # Wrapper shell
│   └── README.md           # Documentació de l'extensió
├── tools/                  # Scripts de tests
└── README.md
```

## Protocol de Seguretat

- Tot el clau d'encodinament es deriva de la contrasenya mestra
- Els fills de contrasenya s'esborren immediatament de la memòria
- Les contrasenyes no s'estalvien en fitxers (només al fitxer blocat)
- Bloqueig automàtic per a atacs de força bruta

- L'autenticació per graella d'imatge depèn dels fragments guardats al keyring d'aquest dispositiu; sense ells la caixa no es pot desxifrar ni traslladar a un altre dispositiu.

## Enllaços

- [GitHub](https://github.com/julsehn/Password-Manager-Cloud)
- [Documentació Completa](https://docs.password-manager.cloud)

## Llicència

MIT License - Lliure d'utilitzar, estudiar, modificar i redistribuir.

# Caixa Forta - Password Manager

Una aplicació de gestió de contrasenyes de codi obert per a Mac, Windows i Linux.

![Caixa Forta](https://img.shields.io/badge/License-MIT-yellow.svg)
![Python](https://img.shields.io/badge/Python-3.12+-blue)
![PyQt6](https://img.shields.io/badge/PyQt6-6.6+-green)

## Característiques

- 🔐 **Criptografia end-a-end**: Totes les dades s'encifren localment amb AES-256-GCM
- ☁️ **Sync a la núvol**: Sync automàtic amb Railway API
- 🔒 **Protecció contra força bruta**: Bloqueig després de 10 intents fallits
- 📱 **Té telafona amigable**: Interfície gràfica moderna amb PyQt6
- 🎯 **Autocompliment**: Omple automàticament formularis amb contrasenyes
- 🔋 **Bloqueig automàtic**: La caixa forta es bloqueja per inactivitat

## Requereiximents

- Python 3.10+
- PyQt6
- Rust (només si composes amb Tauri)

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

```bash
python main.py
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
   - Crea una nova caixa forta núvol (obté un vault_id i token)

3. **Sincronització**:
   - Pujar o descarregar la caixa forta des del menú "Remot"

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
├── main.py                 # Entrada de l'aplicació
├── src/
│   ├── config.py           # Gestió de configuració
│   ├── models.py           # Model de dades d'entrada
│   ├── storage.py          # Codi per emmagatzemar/fer una còpia de seguretat
│   ├── encryption.py       # Codi d'encodinament
│   ├── railway_client.py   # Client API Railway
│   ├── remote_vault.py     # Gestió de la caixa forta remota
│   ├── password_manager.py # Gestor de contrasenyes en memòria
│   └── ui/
│       ├── main_window.py  # Finestra principal
│       ├── qt_compat.py    # Compatibilitat PyQt6
│       └── dialogs.py      # Diàlegs addicionals
├── src-web/                # Frontend web (per a la versió Tauri)
├── browser-extension/      # Extensió del navegador (opcional)
├── tests/                  # Tests de seguretat
├── tools/                  # Scripts de tests
└── README.md
```

## Protocol de Seguretat

- Tot el clau d'encodinament es deriva de la contrasenya mestra
- Els fills de contrasenya s'esborren immediatament de la memòria
- Les contrasenyes no s'estalvien en fitxers (només al fitxer blocat)
- Bloqueig automàtic per a atacs de força bruta

## Enllaços

- [GitHub](https://github.com/julsehn/Password-Manager-Cloud)
- [Documentació Completa](https://docs.password-manager.cloud)

## Llicència

MIT License - Lliure d'utilitzar, estudiar, modificar i redistribuir.

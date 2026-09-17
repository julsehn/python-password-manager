# Caixa Forta - Cross-Platform Launchers

## Overview

This project includes automated launchers for both macOS and Windows that handle:
- Dependency installation
- Browser extension building
- Firefox extension loading
- Native messaging host startup
- Main application launch

---

## macOS Launcher: `Obrir_Caixa_Forta.command`

### Features

1. **Automatic Cleanup**
   - Kills previous Vite processes (port 1420)
   - Kills previous Tauri app instances
   - Kills previous native messaging host processes
   - Cleans up `dist/` and `.vite/` directories

2. **Vault Management**
   - Detects existing vault at `~/.password_manager/vault.json`
   - Prompts to delete or preserve before restart

3. **Firefox Extension Auto-Loading**
   - Checks if Firefox is running
   - Starts Firefox if needed
   - Loads extension from `browser-extension/manifest.json`
   - Uses AppleScript for automation

4. **Native Messaging Host**
   - Starts `caixa_forta_native.py` in background
   - Runs with `nohup` for persistence
   - Logs to `/dev/null`

5. **Application Launch**
   - Prioritizes Tauri desktop app
   - Falls back to web interface if Rust not available

### Usage

```bash
# Double-click to run
./Obrir_Caixa_Forta.command

# Or run from terminal
open Obrir_Caixa_Forta.command
```

### Cleanup on Exit

The launcher automatically cleans up:
- Vite processes
- Tauri app instances
- Native messaging host processes

This ensures a clean state on every launch.

---

## Windows Launcher: `Obrir_Caixa_Forta.bat`

### Features

1. **Automatic Cleanup**
   - Kills previous Vite processes (node.exe on port 1420)
   - Kills previous Tauri app instances (caixa-forta.exe)
   - Kills previous native messaging host processes (python.exe)
   - Cleans up `dist/` and `.vite/` directories

2. **Vault Management**
   - Detects existing vault at `%USERPROFILE%\.password_manager\vault.json`
   - Prompts to delete or preserve before restart

3. **Firefox Extension Auto-Loading**
   - Checks if Firefox is running
   - Starts Firefox if needed
   - Loads extension from `browser-extension\manifest.json`
   - Uses Firefox automation API

4. **Native Messaging Host**
   - Starts `caixa_forta_native.py` in background
   - Runs as detached process
   - No console output interference

5. **Application Launch**
   - Prioritizes Tauri desktop app
   - Falls back to web interface if Rust not available

### Usage

```batch
# Double-click to run
Obrir_Caixa_Forta.bat

# Or run from command prompt
cd The-vault-project\python-password-manager
Obrir_Caixa_Forta.bat
```

### Prerequisites

- Windows 10/11
- Node.js installed
- Firefox installed (default: `C:\Program Files\Mozilla Firefox\firefox.exe`)
- Optional: Rust/Cargo for Tauri desktop app

### Cleanup on Exit

The batch file automatically cleans up:
- Vite processes
- Tauri app instances
- Native messaging host processes

This ensures a clean state on every launch.

---

## Architecture Comparison

| Feature | macOS | Windows |
|---------|-------|---------|
| **Process Detection** | `pgrep`, `lsof` | `tasklist`, `findstr` |
| **Process Killing** | `kill` | `taskkill /F` |
| **Firefox Launch** | `open -a Firefox` | `start "" "firefox.exe"` |
| **Automation** | AppleScript | Firefox automation API |
| **Background Process** | `nohup` | `start /B` |
| **Path Handling** | POSIX paths | Windows paths with backslashes |
| **Variable Expansion** | `$(...)` | `set "VAR=..."` |

---

## Native Messaging Integration

Both launchers automatically:

1. **Build the extension** (if `build.sh`/`build.bat` exists)
2. **Load Firefox extension** (temporary mode)
3. **Start native messaging host** (background)
4. **Launch main application**

The native messaging host must be running for the extension to communicate with the backend.

---

## Troubleshooting

### macOS Issues

**Extension not loading:**
```bash
# Manually load extension
open -a Firefox
# Go to about:debugging → Load Temporary Add-on...
# Select: browser-extension/manifest.json
```

**Native messaging host not starting:**
```bash
# Check if running
pgrep -f caixa_forta_native.py

# Start manually
python3 browser-extension/native/caixa_forta_native.py
```

**Firefox automation fails:**
```bash
# Make sure Firefox is running before launching launcher
open -a Firefox
# Then run the launcher
```

### Windows Issues

**Extension not loading:**
```batch
# Manually load extension
firefox.exe
# Go to about:debugging → Load Temporary Add-on...
# Select: browser-extension\manifest.json
```

**Native messaging host not starting:**
```batch
# Check if running
tasklist | findstr caixa_forta_native

# Start manually
python browser-extension\native\caixa_forta_native.py
```

**Firefox automation fails:**
```batch
# Make sure Firefox is running before launching launcher
start "" "C:\Program Files\Mozilla Firefox\firefox.exe"
# Then run the launcher
```

---

## Security Notes

Both launchers implement:

1. **Process Isolation** - Each component runs independently
2. **Cleanup on Exit** - Prevents zombie processes
3. **Vault Protection** - Prompts before deleting sensitive data
4. **Error Handling** - Graceful degradation on failures

---

## File Structure

```
The-vault-project/python-password-manager/
├── Obrir_Caixa_Forta.command    # macOS launcher
├── Obrir_Caixa_Forta.bat        # Windows launcher
├── browser-extension/
│   ├── manifest.json            # Extension manifest
│   ├── native/
│   │   └── caixa_forta_native.py  # Native messaging host
│   └── build.bat                # Extension builder (Windows)
└── node_modules/.bin/tauri.cmd  # Tauri CLI (Windows)
```

---

## Version History

### v1.2.0 (Current)
- Added automatic Firefox extension loading
- Added native messaging host auto-start
- Improved cleanup procedures
- Added vault deletion prompt

### v1.1.0
- Initial macOS launcher
- Basic dependency installation
- Tauri app launch

### v1.0.0
- Initial Windows launcher
- Basic dependency installation
- Web interface launch

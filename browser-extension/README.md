# Caixa Forta Browser Extension

This browser extension enables autofill functionality for the Caixa Forta password manager desktop application.

## Features

- Autofill login credentials for websites
- Save new credentials to local password manager
- Cross-browser compatibility (Chrome & Firefox)
- Secure communication with local desktop app

## Installation

1. For Chrome: 
   - Open Extensions in Chrome (chrome://extensions)
   - Enable Developer mode
   - Click "Load unpacked" and select this folder

2. For Firefox:
   - Open about:debugging
   - Click "This Firefox"
   - Click "Load Temporary Add-on"
   - Select any file in this folder

## Configuration

The extension communicates with the local password manager app on port 3000 by default.

## Security

All communication between the extension and the local app happens locally using secure protocols.

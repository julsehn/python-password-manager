# Caixa Forta Browser Extension

This browser extension provides local autofill functionality for Caixa Forta credentials.

## Features

- Autofill login credentials for websites
- Save new credentials to extension storage
- Cross-browser compatibility (Chrome & Firefox)
- Browser-local credential storage

## Installation

1. For Chrome:
   - Open Extensions in Chrome (chrome://extensions)
   - Enable Developer mode
   - Click "Load unpacked" and select `build/chrome`

2. For Firefox:
   - Open about:debugging
   - Click "This Firefox"
   - Click "Load Temporary Add-on"
   - Select `build/firefox/manifest.json`

## Storage

Credentials are stored in the browser's extension storage and keyed by site hostname.
The extension does not currently synchronize with the Caixa Forta desktop vault.

## Security

Use the browser's extension storage controls to remove saved credentials. Do not load the
unpacked extension into an untrusted browser profile.

# Browser Extension Security

## Communication paths

- The extension uses browser native messaging to communicate with `browser-extension/native/caixa_forta_native.py`.
- The native host sends authenticated requests to the desktop app's loopback HTTP service at `127.0.0.1:8080`.
- The desktop UI uses Tauri IPC for frontend-to-Rust commands. The extension does not use Tauri IPC.
- The loopback service accepts connections only from loopback addresses and validates paired-client signatures or session tokens on protected routes.

## Data handling

- The local vault is encrypted by the desktop app before it is written to disk or uploaded.
- The cloud service stores encrypted vault blobs and account password hashes; it does not receive the master password used for local vault encryption.
- Extension content scripts create save prompts with text nodes. Credential passwords are not stored in popup DOM attributes.
- Keep browser extension permissions limited to the supported local service and sites where autofill is needed.

## Operational notes

- The local service prefers port `8080`; if occupied, it binds an available loopback port and publishes it for the native host.
- The native host and browser extension must be installed and paired with the desktop app before credential access is available.
- Do not treat this document as a substitute for reviewing the implementation and platform-specific packaging configuration.

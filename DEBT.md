# Technical Debt Audit

Audit date: 2026-10-24

## Scope and architecture

The normal macOS launcher starts the Tauri application. Its active interface is
the Vite frontend in `src-web/`, and its Rust commands and vault workflows are
in `src-tauri/`. The repository also contains a Python/PyQt application in
`src/` and a browser extension with native messaging support. Those are separate
runtime surfaces and should not be refactored as if they were one application.

Main dependency groups:

- Rust/Tauri: dependencies are declared in `src-tauri/Cargo.toml`; they include
  Tauri, Tokio, Reqwest, Serde, and the vault cryptography crates.
- Frontend: `package.json` declares Vite, the Tauri JavaScript API, and Lucide.
- Python: `requirements.txt` declares PyQt6, Cryptography, Argon2, and Pytest.
- Browser extension: source is plain JavaScript and browser APIs; its build
  entry point is `browser-extension/build.sh`.

## Findings

1. `src-web/main.js` remains a large JavaScript module containing the active UI
   and frontend workflows. Import parsing/normalization has been extracted to
   `src-web/importers.js`, but view state and event handling still need further
   decomposition. ESLint and Prettier now cover maintained frontend/extension
   sources; JavaScript still has no static type checker.
2. `src-tauri/src/lib.rs` is a roughly 1,500-line module combining Tauri setup,
   command registration, vault operations, authentication, and sync integration.
   The first refactoring pass moved shared vault data structures into
   `src-tauri/src/vault.rs`; command responsibilities still need decomposition.
3. `src-tauri/src/server.rs` is an 814-line local API module that handles
   session state and request-facing behavior. It uses mutex locks with
   `unwrap()`, so poisoned locks can panic the server instead of returning a
   controlled error.
4. `src-tauri/src/railway.rs` is a 347-line cloud client. HTTP client setup,
   configuration validation, and response error handling are repeated across
   operations. There are no module-local Railway tests in the inspected source.
5. `src-web/styles.css` and `src-web/secure.css` contain 1,694 and 1,645 lines,
   respectively. Their styling ownership and overlap should be checked before
   splitting or removing rules.
6. Rust tests are colocated in `lib.rs`, `security/mod.rs`, and `server.rs`;
   Python and Node tests now cover storage, authentication, sync parsing, UI
   tutorial navigation, and native messaging. Python still has no workspace-wide
   static type checker; Pylance type diagnostics are being used for sensitive
   modules as they are refactored.

## Refactoring order

1. **`src-tauri/src/lib.rs`**: extract cohesive command groups while preserving
   command names, payloads, vault serialization, and authentication behavior.
2. **`src-tauri/src/server.rs`**: replace panic-prone mutex access with explicit
   error handling and add tests for poisoned-lock/session behavior.
3. **`src-web/main.js`**: split rendering, state transitions, and event wiring
   into modules while preserving Tauri command names and visible behavior.
4. **`src-web/styles.css` and `src-web/secure.css`**: establish stylesheet
   ownership and visual regression checks before consolidating rules.
5. **Python UI modules**: continue reducing `main_window.py` and `dialogs.py`,
   and finish type contracts for storage and Qt callback boundaries.
6. **Native host and browser popup**: split the large message router and popup
   controller only behind protocol-level tests.

## Guardrails observed

- `cargo test --manifest-path src-tauri/Cargo.toml` passes all 14 Rust tests.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets` passes.
  The large Tauri command signature retains its frontend contract and uses a
  function-scoped `too_many_arguments` allowance.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` passes.
- `npm test`, `npm run lint`, `npm run format:check`, and `npm run build` all pass.
- Python: `python -m pytest -q` passes 21 tests; Ruff check and format checks pass.
  `requests` is now declared because the Railway client imports it.
- Shell scripts for Bash/zsh pass syntax checks. Windows batch files cannot be
  executed or validated on this macOS environment.
- `#![deny(warnings)]` and Clippy now pass together. There is still no explicit
  strict type-check command for JavaScript or Python.

Initial baseline on 2026-10-24: the frontend build and Rust tests passed, while
Python test discovery failed due to a missing `requests` dependency and tests
with import-time side effects. Those setup issues are now corrected and the
Python suite passes.

## First refactoring pass

- Centralized the vault models in `src-tauri/src/vault.rs` while preserving the
  existing Tauri crate-root types and Serde defaults for older vault data.
- Extracted the shared trash-visibility rule into a pure helper and added tests
  for legacy deserialization and timestamp boundaries.
- Resolved all 14 initial Clippy findings without changing the frontend command
  contract. The full Tauri command signature remains explicitly exempted from
  Clippy's argument-count heuristic.
- Formatted all Rust, Python, frontend, and extension source files with their
  configured formatters; generated build directories remain excluded.
- Extracted frontend import parsing to `src-web/importers.js` and added Node tests
  for CSV quoting, nested exports, invalid records, and folder normalization.
- Added ESLint, Prettier, Ruff, and pytest guardrails, plus isolated smoke tests
  for the UI, native host, secure API, secrets, storage, and Railway sync.
- Added explicit JWT claim, serialized credential, server JSON, and Railway JSON
  types. Fixed the Python Railway client to use the configured token separately
  from the vault ID, and corrected its URL construction, retry bound, and 204
  response handling.
- Removed unsafe test side effects: tests now use temporary vaults/secrets and
  an ephemeral server port. A test must never write to the default user vault.
- Remaining work is tracked in the refactoring order above; the largest UI,
  command, and native-host modules have not yet been split into smaller files.

## Critical flows to protect

- Create, unlock, update, lock, import, and export an encrypted local vault.
- Change authentication methods and master password without losing vault data.
- Authenticate local extension requests and maintain server session state.
- Upload, download, register, and delete remote vaults without changing the
  encrypted blob or overwriting local data unexpectedly.
- Build and launch the Tauri frontend with its registered command contract.

Add or strengthen focused smoke tests for a flow before refactoring its owner.
Never use real credentials, vault files, or production cloud accounts in tests.

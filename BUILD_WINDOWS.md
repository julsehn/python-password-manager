# Building for Windows

## Prerequisites
1. Windows development machine or WSL
2. Rust and Cargo installed
3. Tauri CLI
4. Visual Studio Build Tools (for Windows targets)

## Building for Windows

### Using Tauri CLI

To build the application for Windows, use the Tauri CLI:

```bash
# Install Tauri dependencies if not already installed
npm install @tauri-apps/cli -g

# Navigate to the project directory
cd /Users/juls/Documents/GitHub/python-password-manager

# Build for Windows
tauri build --target x86_64-pc-windows-msvc
```

### Prerequisites on Windows

To successfully build for Windows on macOS or Linux, you need to:

1. Install the Windows target for Rust:
   ```bash
   rustup target add x86_64-pc-windows-msvc
   ```

2. Install MSVC (Microsoft Visual C++ Build Tools) for Windows development

3. For CI/CD or cross-compilation builds, ensure you have the Windows SDK and tools

### Windows Bundle Configuration

The build configuration in `tauri.conf.json` already includes:
- Target "all" bundles (all supported platforms)
- Windows-specific configuration (Wix installer support)
- Proper app metadata (product name, version, identifiers)
- Security headers (CSP settings)

### Build Artifacts

After successful compilation, you'll find:
- `.exe` files in `src-tauri/target/release/bundle`
- Installer `.msi` files for Windows installation
- Application bundles with required resources

### Troubleshooting Windows Builds

If you encounter build failures:
1. Ensure Rust is properly installed with the Windows target:
   ```bash
   rustup target add x86_64-pc-windows-msvc
   ```

2. Check that all Tauri dependencies are properly installed:
   ```bash
   npm install @tauri-apps/cli
   ```

3. Make sure you're running a compatible version of Tauri CLI

## Continuous Integration Example

For CI builds:

```yaml
# Example GitHub Actions workflow for Windows build
name: Build Windows Release

on:
  push:
    branches: [ main ]

jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install Rust
        uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
          target: x86_64-pc-windows-msvc
      
      - name: Install Tauri dependencies
        run: npm install @tauri-apps/cli -g
        
      - name: Build Tauri App
        run: |
          cd src-tauri
          npm install
          tauri build
```

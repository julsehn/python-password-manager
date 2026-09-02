# Cloud Backup and Repository Sync Features

## Overview
This document outlines the cloud backup and repository synchronization features added to the password manager.

## Cloud Backup Features

### Railway Encrypted Vault Service

The repository includes a deployable service in `railway-vault/` for hosting encrypted vault envelopes on Railway. Encryption remains client-side: the service stores an opaque blob, a hash of the vault token, and revision metadata. It cannot decrypt vault contents.

- Deploy `railway-vault/` with its Dockerfile.
- Attach a Railway Volume at `/data` so the SQLite database survives redeploys.
- Generate a unique vault ID and a random token of at least 32 bytes on the client.
- Treat `409` upload responses as conflicts and merge locally before retrying.
- Use HTTPS and never send a master password to the service.

See [railway-vault/README.md](railway-vault/README.md) for the API contract.

### Supported Cloud Services
- Dropbox (currently supported)
- Google Drive (planned)
- OneDrive (planned)

### Backup Capabilities
1. **Automatic Backup**: Configurable frequency backups to cloud storage
2. **Encrypted Storage**: Vault data is encrypted before being sent to cloud services
3. **Backup History**: Track and view backup reports with timestamps
4. **Secure Authentication**: Tokens stored securely and used for cloud service authentication

### Configuration
- Service selection (Dropbox, Google Drive, etc.)
- Authentication tokens
- Backup frequency (minutes)
- Backup path within cloud storage

### API Endpoints
- `backup_vault(config: BackupConfig)` - Backup vault to cloud storage
- `get_backup_config()` - Retrieve current backup configuration  
- `set_backup_config(config: BackupConfig)` - Set new backup configuration
- `get_backup_reports(limit: usize)` - Retrieve recent backup reports

## Repository Synchronization

### Repository Sync Features
1. **Repository Tracking**: Sync with Git repositories (GitHub, GitLab, etc.)
2. **Automatic Updates**: Get updates from repository with ease
3. **Conflict Handling**: Merge local and repository changes properly
4. **Secure Authentication**: Authentication tokens for repository access

### Configuration
- Repository URL (GitHub/GitLab/etc.)
- Authentication token (GitHub personal access token)
- Target branch to synchronize with
- Sync interval in minutes

### API Endpoints  
- `sync_vault(config: SyncConfig)` - Sync vault with Git repository
- `get_repo_config()` - Get current repository configuration
- `set_repo_config(config: SyncConfig)` - Update repository config

## Implementation Details

### Security Considerations
- All cloud authentication tokens are stored securely
- Vault data is encrypted before transmission
- API communication uses secure channels
- Backup history is stored in a local cache within app directory

### Integration Points
- Tauri IPC handlers exposed for cloud operations
- Rust-based cloud backup engine with extensible design
- Support for additional cloud services through plugin architecture

## Usage Examples

### Setup Cloud Backup
```javascript
// Configure backup to Dropbox
const backupConfig = {
  service: 'dropbox',
  auth_token: 'your_dropbox_token',
  frequency: 60,
  enabled: true,
  backup_path: '/CaixaForta/'
};

// Apply configuration
await window.__TAURI__.invoke('set_backup_config', { config: backupConfig });
```

### Synchronize with Repository
```javascript
// Configure repo sync
const repoConfig = {
  repository_url: 'https://github.com/username/password-manager-repo.git',
  auth_token: 'your_github_token',
  branch: 'main',
  enabled: true,
  interval: 30
};

// Sync vault with repository
await window.__TAURI__.invoke('sync_vault', { config: repoConfig });
```

### Check Backup Status
```javascript
// Get recent backup reports
const reports = await window.__TAURI__.invoke('get_backup_reports', { limit: 5 });
```

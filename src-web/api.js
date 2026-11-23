/**
 * SherLock - Frontend Tauri API Client
 * Centralized, typed wrapper for all Tauri IPC commands.
 */

import { invoke } from "@tauri-apps/api/core";

export const api = {
  lockVault: () => invoke("lock_vault"),
  getVaultInfo: () => invoke("get_vault_info"),
  getVaultEntries: () => invoke("get_vault_entries"),
  unlockVault: (masterPassword) => invoke("unlock_vault", { masterPassword }),
  saveVault: (payload) => invoke("save_vault", payload),
  updateEntry: (payload) => invoke("update_entry", payload),
  changeMasterPassword: (payload) => invoke("change_master_password", payload),
  listPairedClients: () => invoke("list_paired_clients"),
  generatePairingCode: () => invoke("generate_pairing_code"),
  revokePairedClient: (clientId) =>
    invoke("revoke_paired_client", { clientId }),
  resetVault: () => invoke("reset_vault"),
  hideMainWindow: () => invoke("hide_main_window"),
  registerOfficialCloud: (payload) =>
    invoke("register_official_cloud", payload),
  authOfficialCloud: (payload) => invoke("auth_official_cloud", payload),
  revokeOfficialCloudSession: (payload) =>
    invoke("revoke_official_cloud_session", payload),
  setRailwaySyncConfig: (payload) => invoke("set_railway_sync_config", payload),
  syncUploadVault: (payload) => invoke("sync_upload_vault", payload),
  syncDownloadVault: (payload) => invoke("sync_download_vault", payload),
};

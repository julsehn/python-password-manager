/**
 * SherLock - Frontend Tauri API Client
 * Centralized, typed wrapper for all Tauri IPC commands.
 */

import { invoke } from "@tauri-apps/api/core";

export const api = {
  lockVault: () => invoke("lock_vault"),
  getImageGridAuth: () => invoke("get_image_grid_auth"),
  getVaultInfo: () => invoke("get_vault_info"),
  getAuthInfo: () => invoke("get_auth_info"),
  getVaultEntries: () => invoke("get_vault_entries"),
  unlockVault: (masterPassword) => invoke("unlock_vault", { masterPassword }),
  unlockVaultGrid: (payload) => invoke("unlock_vault_grid", payload),
  saveVault: (payload) => invoke("save_vault", payload),
  updateEntry: (payload) => invoke("update_entry", payload),
  setImageGridAuth: (payload) => invoke("set_image_grid_auth", payload),
  initEmptyGridVault: (payload) => invoke("init_empty_grid_vault", payload),
  changeVaultToImageGrid: (payload) =>
    invoke("change_vault_to_image_grid", payload),
  changeVaultToPassword: (payload) =>
    invoke("change_vault_to_password", payload),
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

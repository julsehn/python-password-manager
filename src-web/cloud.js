/**
 * Caixa Forta - Railway Cloud Sync Operations
 * Helpers for cloud configuration, payload serialization, and sync lifecycle.
 */

export function rustCloudConfig(config = {}) {
  return {
    railway_url: config.railwayUrl || "",
    vault_id: config.vaultId || "",
    token: config.token || "",
  };
}

export function loadSavedCloudConfig() {
  try {
    return JSON.parse(localStorage.getItem("caixa-forta-cloud") || "{}");
  } catch {
    return {};
  }
}

export function persistCloudConfig(config) {
  localStorage.setItem("caixa-forta-cloud", JSON.stringify(config));
}

export function clearCloudConfig() {
  localStorage.removeItem("caixa-forta-cloud");
}

/**
 * SherLock - Railway Cloud Sync Operations
 * Helpers for cloud configuration, payload serialization, and sync lifecycle.
 */

export function rustCloudConfig(config = {}) {
  return {
    railway_url: config.railwayUrl || "",
    vault_id: config.vaultId || "",
    token: config.token || "",
    cloud_version:
      typeof config.cloudVersion === "number" ? config.cloudVersion : null,
  };
}

export function loadSavedCloudConfig() {
  try {
    return JSON.parse(localStorage.getItem("sherlock-cloud") || "{}");
  } catch {
    return {};
  }
}

export function persistCloudConfig(config) {
  localStorage.setItem("sherlock-cloud", JSON.stringify(config));
}

export function clearCloudConfig() {
  localStorage.removeItem("sherlock-cloud");
}

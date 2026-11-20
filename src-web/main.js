import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api.js";
import {
  escapeHtml,
  sanitizedFragment,
  replaceMarkup,
  appendMarkup,
  mapVaultEntry,
  isTauriRuntime,
  pairingSecondsRemaining,
} from "./utils.js";
import {
  normalizeImportedEntries,
  normalizeImportedFolders,
  parseCsv,
} from "./importers.js";
import { createViews } from "./views.js";
import { createIcons } from "lucide";
import {
  defaultSettings,
  folderColors,
  folderIcons,
  icon,
  icons,
} from "./constants.js";
import {
  generateValue as generateCredentialValue,
  passwordStrength,
} from "./generator.js";
import "./styles.css";
import "./secure.css";

let autoLockTimer;

let paletteHideTimer;

const savedSettings = (() => {
  try {
    const parsed = JSON.parse(
      localStorage.getItem("sherlock-settings") || "{}",
    );
    return { ...defaultSettings, ...parsed };
  } catch {
    return { ...defaultSettings };
  }
})();

const savedCloudConfig = (() => {
  try {
    return JSON.parse(localStorage.getItem("sherlock-cloud") || "{}");
  } catch {
    return {};
  }
})();

let lastLockedState = null;
let browserPairingPollingTimer = null;
let browserPairingExpirationTimer = null;

const state = {
  locked: true,
  vaultExists: null,
  showWelcome: false,
  welcomeStep: 0,
  showFirstEntryGuide: false,
  firstEntryGuideStep: 1,
  loading: false,
  entries: [],
  folders: [],
  activeFolderId: "",
  history: [],
  trash: [],
  query: "",
  showCommandPalette: false,
  paletteQuery: "",
  paletteIndex: 0,
  paletteCopiedId: null,
  error: "",
  toast: "",
  viewingEntryId: null,
  editingEntryId: null,
  entryFormDraft: null,
  showEntryForm: false,
  showTrashModal: false,
  showResetConfirm: false,
  showFolderModal: false,
  editingFolderId: null,
  returnToEntryForm: false,
  settings: savedSettings,
  pairedBrowsers: [],
  browserPairingCode: "",
  cloudConfig: { railwayUrl: "", vaultId: "", token: "", ...savedCloudConfig },
  showCloudLogin: false,
  cloudLoading: false,
  cloudError: "",
  cloudTab: "login",
  showDownloadPassword: false,
  downloadPassword: "",
  cloudActionContext: "settings",
  cloudShowAdvanced: false,
  cloudUsernameChecking: false,
  cloudUsernameAvailable: null,
  cloudFormUsername: "",
  cloudUsernameCheckError: "",
  formError: "",
  folderFormError: "",
  saving: false,
  view: "vault",
  generatorType: "password",
  generatorLanguage: "Català",
  generatedValue: "",
  generatorOptions: {
    length: 20,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
    words: 6,
    separator: "-",
    removeAccents: false,
    onlyUnaccented: false,
  },
  showAuthMethodSelection: false,
  authMethodSelected: "password",
  showGridSetup: false,
  gridSetupError: "",
  imageAuthImage: "",
  imageGridConfigured: false,
  imageGridPattern: [],
  imageGridBrushPath: [],
  imageUnlockBrushPath: [],
  changingAuthMethod: false,
  showGridUnlock: false,
  gridUnlockError: "",
  showChangeAuthModal: false,
  changeAuthSelected: "password",
  changeAuthBusy: false,
  changeAuthError: "",
};

const views = createViews(state);

let imageAuthRenderSource = "";
let imageAuthRenderBitmap = null;

function showToast(message) {
  state.toast = message;
  render();
  setTimeout(() => {
    state.toast = "";
    render();
  }, 2400);
}

function resetAutoLock() {
  clearTimeout(autoLockTimer);
  if (state.settings.autoLock === "never") return;
  const minutes = Number(state.settings.autoLock);
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  autoLockTimer = setTimeout(() => lockVault(), minutes * 60_000);
}

async function lockVault() {
  if (state.locked) return;
  clearTimeout(autoLockTimer);
  clearTimeout(clipboardCleanupTimer);
  try {
    await navigator.clipboard.writeText("");
  } catch (e) {
    // Failed to clear clipboard; silently give up
  }
  stopBrowserPairingTimers();
  state.browserPairingCode = "";
  try {
    await api.lockVault();
  } catch (error) {
    showToast(`No s'ha pogut bloquejar SherLock: ${error}`);
    resetAutoLock();
    return;
  }

  state.locked = true;
  state.entries = [];
  state.folders = [];
  state.history = [];
  state.trash = [];
  state.query = "";
  state.showChangeAuthModal = false;
  state.showGridSetup = false;
  state.gridUnlockError = "";
  state.imageGridConfigured = false;
  state.imageGridPattern = [];
  state.imageUnlockBrushPath = [];
  state.imageAuthImage = "";
  state.showGridUnlock = false;

  try {
    const authData = await api.getImageGridAuth();
    if (authData?.type === "image_grid" && authData.version === 5) {
      state.imageAuthImage = authData.image_data || "";
      state.imageGridConfigured = true;
      state.showGridUnlock = true;
    }
  } catch {
    state.showGridUnlock = false;
  }
  state.view = "vault";
  render();
}

async function initializeApp() {
  render();
  if (!isTauriRuntime()) return;
  try {
    const info = await api.getVaultInfo();
    state.vaultExists = Boolean(info.exists);

    if (!state.vaultExists) {
      state.showWelcome = false;
      state.showAuthMethodSelection = true;
    } else {
      const hasGridAuth = await checkGridAuth();
      if (hasGridAuth) {
        state.imageGridPattern = [];
        const imageGrid = await api.getImageGridAuth();
        state.imageAuthImage = imageGrid.image_data;
        state.imageGridConfigured = true;
        state.showGridUnlock = true;
      }
    }

    render();
  } catch {
    state.vaultExists = null;
  }
}

function rustCloudConfig(config) {
  return {
    railway_url: config?.railwayUrl || "",
    vault_id: config?.vaultId || "",
    token: config?.token || "",
    cloud_version:
      typeof config?.cloudVersion === "number" ? config.cloudVersion : null,
  };
}

function updateLocalCloudVersion(version) {
  if (typeof version === "number") {
    state.cloudConfig.cloudVersion = version;
    localStorage.setItem("sherlock-cloud", JSON.stringify(state.cloudConfig));
  }
}

async function refreshCloudVersionFromBackend() {
  try {
    const version = await invoke("get_cloud_version");
    if (typeof version === "number") {
      updateLocalCloudVersion(version);
    }
  } catch {}
}

async function checkUsernameAvailability() {
  if (state.cloudTab !== "register") return;
  const username = document.querySelector("#auth-username")?.value.trim() || "";
  state.cloudFormUsername = username;
  if (username.length < 3) return;

  const customUrl =
    document.querySelector("#cloud-railway-url")?.value.trim() || "";

  state.cloudUsernameChecking = true;
  state.cloudUsernameAvailable = null;
  state.cloudUsernameCheckError = "";
  state.cloudError = "";
  render();

  try {
    const available = await invoke("check_railway_username", {
      username,
      railwayUrl: customUrl || null,
    });
    state.cloudUsernameAvailable = available === true;
    if (!available) {
      state.cloudError = `El nom d'usuari "${username}" ja existeix. Tria'n un altre.`;
    }
  } catch (error) {
    state.cloudUsernameAvailable = null;
    state.cloudUsernameCheckError = String(error || "No s'ha pogut comprovar el nom d'usuari.");
  } finally {
    state.cloudUsernameChecking = false;
    render();
  }
}

async function cloudAuthSubmit(event) {
  event.preventDefault();
  state.cloudError = "";

  const username = document.querySelector("#auth-username")?.value.trim() || "";
  const password = document.querySelector("#auth-password")?.value || "";
  const customUrl =
    document.querySelector("#cloud-railway-url")?.value.trim() || "";
  const customVaultId =
    document.querySelector("#cloud-vault-id")?.value.trim() || "";

  if (!username) {
    state.cloudError = "Introdueix el teu nom d'usuari de Railway.";
    render();
    return;
  }
  if (!password) {
    state.cloudError = "Introdueix la contrasenya de Railway.";
    render();
    return;
  }

  const isRegister = state.cloudTab === "register";

  if (isRegister) {
    // Block submit if username check shows it's taken
    if (state.cloudUsernameAvailable === false) {
      state.cloudError = "Aquest nom d'usuari ja existeix. Tria'n un altre.";
      render();
      return;
    }

    const confirmPassword =
      document.querySelector("#auth-confirm-password")?.value || "";
    const privacyAccepted =
      document.querySelector("#privacy-accepted")?.checked || false;

    if (password !== confirmPassword) {
      state.cloudError = "Les contrasenyes no coincideixen.";
      render();
      return;
    }
    if (password.length < 8) {
      state.cloudError =
        "La contrasenya de Railway ha de tenir almenys 8 caràcters.";
      render();
      return;
    }
    if (!privacyAccepted) {
      state.cloudError =
        "Has d'acceptar la Política de Privacitat per registrar-te.";
      render();
      return;
    }

    state.cloudLoading = true;
    render();

    try {
      const authData = await invoke("register_official_cloud", {
        username,
        password,
        railwayUrl: customUrl || null,
      });

      const updatedConfig = {
        ...state.cloudConfig,
        provider: customUrl ? "custom" : "official",
        railwayUrl: customUrl,
        vaultId: customVaultId || authData.vault_id || "",
        token: authData.access_token,
        authUser: authData.username,
      };

      state.cloudConfig = updatedConfig;
      localStorage.setItem("sherlock-cloud", JSON.stringify(updatedConfig));
      await invoke("set_railway_sync_config", rustCloudConfig(updatedConfig));

      if (!state.locked) {
        try {
          const uploadRes = await invoke("sync_upload_vault", {
            config: rustCloudConfig(updatedConfig),
          });
          if (uploadRes && typeof uploadRes.version === "number") {
            updateLocalCloudVersion(uploadRes.version);
          }
          showToast("Compte creat i SherLock sincronitzada a Railway!");
        } catch {
          showToast(`Compte creat com a ${authData.username} a Railway.`);
        }
      } else {
        showToast(`Compte creat com a ${authData.username} a Railway.`);
      }

      state.showCloudLogin = false;
    } catch (error) {
      state.cloudError = String(error);
    } finally {
      state.cloudLoading = false;
      render();
    }
    return;
  }

  // Handle Login
  const isDownload = state.cloudActionContext === "download";
  const isSync = state.cloudActionContext === "sync";
  const masterPassword = state.locked
    ? document.querySelector("#auth-master-password")?.value || ""
    : null;

  if (isDownload && state.locked && !masterPassword) {
    state.cloudError =
      "Introdueix la contrasenya mestra de la SherLock per desxifrar-la.";
    render();
    return;
  }

  state.cloudLoading = true;
  render();

  try {
    const authData = await invoke("auth_official_cloud", {
      username,
      password,
      railwayUrl: customUrl || null,
    });

    const updatedConfig = {
      ...state.cloudConfig,
      provider: customUrl ? "custom" : "official",
      railwayUrl: customUrl,
      vaultId: customVaultId || authData.vault_id || "",
      token: authData.access_token,
      authUser: authData.username,
    };

    state.cloudConfig = updatedConfig;
    localStorage.setItem("sherlock-cloud", JSON.stringify(updatedConfig));
    await invoke("set_railway_sync_config", rustCloudConfig(updatedConfig));

    if (isDownload) {
      const serialized = await invoke("sync_download_vault", {
        masterPassword,
        config: rustCloudConfig(updatedConfig),
      });
      await refreshCloudVersionFromBackend();

      const vault = JSON.parse(serialized);
      state.entries = (vault.entries || []).map(mapVaultEntry);
      state.folders = vault.folders || [];
      state.trash = (vault.deleted_entries || []).map((entry) => ({
        ...entry,
        folderId: entry.folder_id || null,
        createdAt: entry.created_at,
        updatedAt: entry.updated_at,
        deletedAt: entry.deleted_at,
      }));
      state.history = (vault.history || []).map((item) => ({
        ...item,
        type: item.kind,
        createdAt: item.created_at,
      }));
      state.vaultExists = true;
      state.locked = false;
      state.view = "vault";
      state.showCloudLogin = false;
      showToast("SherLock descarregat de Railway i oberta correctament!");
    } else {
      if (isSync && !state.locked) {
        try {
          const result = await invoke("sync_upload_vault", {
            config: rustCloudConfig(updatedConfig),
          });
          if (result && typeof result.version === "number") {
            updateLocalCloudVersion(result.version);
          }
          showToast(result.message || "Canvis sincronitzats amb Railway!");
        } catch (error) {
          showToast(
            `Sessió iniciada, però no s'ha pogut sincronitzar: ${error}`,
          );
        }
      } else {
        showToast(`Sessió iniciada a Railway com a ${authData.username}.`);
      }
      state.showCloudLogin = false;
    }
  } catch (error) {
    state.cloudError = String(error);
  } finally {
    state.cloudLoading = false;
    render();
  }
}

async function handleCloudSyncNow() {
  if (!state.cloudConfig.token) {
    state.showCloudLogin = true;
    state.cloudActionContext = "sync";
    render();
    return;
  }

  if (state.locked) {
    showToast("Desbloqueja la SherLock abans de sincronitzar-la.");
    return;
  }

  state.cloudLoading = true;
  render();

  try {
    const res = await invoke("sync_upload_vault", {
      config: rustCloudConfig(state.cloudConfig),
    });
    if (res && typeof res.version === "number") {
      updateLocalCloudVersion(res.version);
    }
    showToast(res.message || "SherLock pujat correctament a Railway!");
  } catch (err) {
    showToast(`Error de sincronització: ${err}`);
  } finally {
    state.cloudLoading = false;
    render();
  }
}

async function handleCloudDownloadNow() {
  if (!state.cloudConfig.token) {
    state.showCloudLogin = true;
    state.cloudActionContext = "download";
    render();
    return;
  }

  if (state.locked) {
    state.showDownloadPassword = true;
    state.downloadPassword = "";
    state.cloudError = "";
    render();
    return;
  }

  if (!confirmDownload()) {
    return;
  }

  await downloadVaultFromCloud(null);
}

function confirmDownload() {
  return confirm(
    "Això sincronitzarà les dades locals amb la còpia de Railway. Vols continuar?",
  );
}

async function downloadVaultFromCloud(masterPassword) {
  if (!confirmDownload()) {
    return;
  }

  state.cloudLoading = true;
  render();

  try {
    const serialized = await invoke("sync_download_vault", {
      masterPassword,
      config: rustCloudConfig(state.cloudConfig),
    });
    await refreshCloudVersionFromBackend();
    const vault = JSON.parse(serialized);
    state.entries = (vault.entries || []).map(mapVaultEntry);
    state.folders = vault.folders || [];
    state.trash = (vault.deleted_entries || []).map((entry) => ({
      ...entry,
      folderId: entry.folder_id || null,
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
      deletedAt: entry.deleted_at,
    }));
    state.history = (vault.history || []).map((item) => ({
      ...item,
      type: item.kind,
      createdAt: item.created_at,
    }));
    state.vaultExists = true;
    state.locked = false;
    showToast("SherLock descarregat i sincronitzada de Railway!");
  } catch (err) {
    showToast(`Error en descarregar de Railway: ${err}`);
  } finally {
    state.cloudLoading = false;
    render();
  }
}

async function handleCloudLogout() {
  if (
    !confirm(
      "Vols tancar la sessió a Railway? Les teves dades locals es mantindran intactes.",
    )
  ) {
    return;
  }
  const config = rustCloudConfig(state.cloudConfig);
  try {
    await invoke("revoke_official_cloud_session", {
      railwayUrl: config.railway_url,
      vaultId: config.vault_id,
    });
  } catch (error) {
    showToast(`No s'ha pogut revocar la sessió cloud: ${error}`);
    return;
  }
  state.cloudConfig = {
    railwayUrl: "",
    vaultId: "",
    token: "",
    authUser: "",
  };
  localStorage.removeItem("sherlock-cloud");
  try {
    await invoke("set_railway_sync_config", {
      railway_url: "",
      vault_id: "",
      token: "",
    });
  } catch {}
  showToast("Sessió tancada a Railway.");
  render();
}

function resetLocalVault() {
  state.showResetConfirm = true;
  render();
}

function cancelResetLocalVault() {
  state.showResetConfirm = false;
  render();
}

async function confirmResetLocalVault() {
  state.showResetConfirm = false;
  stopBrowserPairingTimers();
  try {
    await invoke("reset_vault");
    state.entries = [];
    state.folders = [];
    state.trash = [];
    state.history = [];
    state.locked = true;
    state.vaultExists = false;
    state.showWelcome = true;
    state.welcomeStep = 0;
    state.firstEntryGuideStep = 1;
    state.view = "vault";
    // Esborra el patró d'imatge i tot l'estat d'autenticació per imatge
    state.imageAuthImage = "";
    state.imageGridConfigured = false;
    state.imageGridPattern = [];
    state.imageGridBrushPath = [];
    state.imageUnlockBrushPath = [];
    state.showGridUnlock = false;
    state.showGridSetup = false;
    state.gridSetupError = "";
    state.gridUnlockError = "";
    state.showAuthMethodSelection = true;
    state.authMethodSelected = "password";
    imageAuthRenderSource = "";
    imageAuthRenderBitmap = null;
    showToast("Dades locals eliminades.");
  } catch (error) {
    showToast(`No s'han pogut eliminar les dades: ${error}`);
  }
  render();
}

function render() {
  const appContainer = document.querySelector("#app");
  if (!appContainer) return;
  document.documentElement.dataset.locked = String(state.locked);

  // Detect lock/unlock transitions to apply entry animation
  let needsTransition = false;
  if (lastLockedState !== null && lastLockedState !== state.locked) {
    needsTransition = true;
  }
  lastLockedState = state.locked;

  const viewMarkup = state.locked
    ? views.lockScreen()
    : state.view === "generator"
      ? views.generatorScreen()
      : state.view === "settings"
        ? views.settingsScreen()
        : views.vaultScreen();
  replaceMarkup(appContainer, viewMarkup);

  // Apply lock/unlock transition animation
  if (needsTransition) {
    const shell = appContainer.querySelector(
      ".lock-shell, .shell, .generator-shell, .settings-shell",
    );
    if (shell) {
      if (state.locked) {
        shell.classList.add("is-locked-transition");
      } else {
        shell.classList.add("is-unlocked-transition");
      }
    }
  }

  if (!state.locked && state.showCommandPalette) {
    appendMarkup(appContainer, views.commandPalette());
  }
  if (!state.locked && state.toast) {
    appendMarkup(
      appContainer,
      `<div class="toast show">${escapeHtml(state.toast)}</div>`,
    );
  }

  createIcons({ icons });
  enhanceRenderedUi();
  applySettings();
  bindEvents();
}

function applySettings() {
  const rawSize = state.settings.fontSize;
  const numSize =
    rawSize === "small"
      ? 14
      : rawSize === "large"
        ? 18
        : rawSize === "medium"
          ? 16
          : Number(rawSize) || 16;
  const clampedSize = Math.min(24, Math.max(12, numSize));
  state.settings.fontSize = String(clampedSize);

  document.documentElement.dataset.theme = state.settings.theme || "auto";
  document.documentElement.dataset.accent = state.settings.accent || "blue";
  document.documentElement.dataset.fontSize = String(clampedSize);

  const themeSelect = document.querySelector("#theme-setting");
  const fontSizeInput = document.querySelector("#font-size-setting");
  const fontSizeOut = document.querySelector("#font-size-value");
  const autoLockSelect = document.querySelector("#auto-lock");

  if (themeSelect) themeSelect.value = state.settings.theme || "auto";
  if (fontSizeInput) fontSizeInput.value = String(clampedSize);
  if (fontSizeOut) fontSizeOut.textContent = `${clampedSize} px`;
  if (autoLockSelect) autoLockSelect.value = state.settings.autoLock || "15";

  document.querySelectorAll("[data-accent]").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.accent === (state.settings.accent || "blue"),
    );
  });
}

function persistSettings() {
  localStorage.setItem("sherlock-settings", JSON.stringify(state.settings));
  applySettings();
}

function enhanceRenderedUi() {
  document.querySelector(".sidebar-note")?.remove();

  const emptyIcon = document.querySelector(".empty > svg");
  if (emptyIcon) {
    emptyIcon.replaceWith(sanitizedFragment(icon("Vault", 28)));
    createIcons({ icons });
  }

  const languageControl = document.querySelector(
    "#generator-language",
  )?.parentElement;
  if (languageControl) {
    languageControl.hidden = state.generatorType === "password";
    languageControl.setAttribute("aria-hidden", String(languageControl.hidden));
  }

  const output = document.querySelector(".generated-card output");
  if (
    output &&
    state.generatorType === "password" &&
    !output.querySelector("span")
  ) {
    replaceMarkup(
      output,
      Array.from(output.textContent || "", (character) => {
        const className = /[0-9]/.test(character)
          ? "generated-number"
          : /[^A-Za-z0-9]/.test(character)
            ? "generated-symbol"
            : "";
        return `<span class="${className}">${escapeHtml(character)}</span>`;
      }).join(""),
    );
  }

  const generatedCard = document.querySelector(".generated-card");
  if (
    generatedCard &&
    state.generatorType === "password" &&
    !document.querySelector(".password-strength")
  ) {
    const strength = passwordStrength(state.generatedValue || generateValue());
    generatedCard.after(
      sanitizedFragment(
        `
      <div class="password-strength">
        <div class="strength-label">
          <span>Força de la contrasenya</span>
          <strong class="strength-${strength.level}">${strength.label}</strong>
        </div>
        <div class="strength-track">
          <span class="strength-fill strength-${strength.level} strength-width-${strength.percent}"></span>
        </div>
        <small>${strength.hint}</small>
      </div>
      `,
      ),
    );
  }
}

function focusPaletteSearch() {
  const input = document.querySelector("#palette-search");
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
}

function openCommandPalette() {
  clearTimeout(paletteHideTimer);
  if (state.locked) return;
  state.showCommandPalette = true;
  state.paletteQuery = "";
  state.paletteIndex = 0;
  state.paletteCopiedId = null;
  render();
  focusPaletteSearch();
}

function closeCommandPalette() {
  clearTimeout(paletteHideTimer);
  state.showCommandPalette = false;
  render();
}

async function selectPaletteEntry(id) {
  clearTimeout(paletteHideTimer);
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;
  const copied = await copySensitiveText(
    entry.password,
    "Contrasenya copiada.",
  );
  if (!copied) return;
  state.paletteCopiedId = id;
  render();
  paletteHideTimer = setTimeout(() => {
    state.showCommandPalette = false;
    render();
    if (isTauriRuntime()) invoke("hide_main_window").catch(() => {});
  }, 850);
}

async function refreshPairedBrowsers() {
  try {
    state.pairedBrowsers = await invoke("list_paired_clients");
  } catch {
    state.pairedBrowsers = [];
  }
}

function stopBrowserPairingTimers() {
  if (browserPairingPollingTimer) {
    clearInterval(browserPairingPollingTimer);
    browserPairingPollingTimer = null;
  }
  if (browserPairingExpirationTimer) {
    clearTimeout(browserPairingExpirationTimer);
    browserPairingExpirationTimer = null;
  }
  // Clear countdown timer via interval reference
  if (typeof window !== "undefined") {
    if (window.__browserPairingCountdownTimer) {
      clearInterval(window.__browserPairingCountdownTimer);
      window.__browserPairingCountdownTimer = null;
    }
  }
}

function startBrowserPairingMonitoring() {
  stopBrowserPairingTimers();

  const poll = async () => {
    const prevCount = state.pairedBrowsers.length;
    try {
      state.pairedBrowsers = await invoke("list_paired_clients");
    } catch {
      // Keep previous state on error; don't reset to empty array
      return;
    }
    if (state.pairedBrowsers.length > prevCount) {
      stopBrowserPairingTimers();
      state.browserPairingCode = "";
      render();
      showToast("Navegador vinculat correctament.");
    }
  };

  browserPairingPollingTimer = setInterval(poll, 2000);

  // Update countdown timer every second
  window.__browserPairingCountdownTimer = setInterval(() => {
    if (Date.now() >= state.browserPairingExpiresAt) {
      clearInterval(window.__browserPairingCountdownTimer);
      stopBrowserPairingTimers();
      state.browserPairingCode = "";
      render();
    } else {
      // Update countdown display without full render
      const remainingEl = document.querySelector("[data-pairing-remaining]");
      if (remainingEl) {
        const remaining = pairingSecondsRemaining(
          state.browserPairingExpiresAt,
        );
        remainingEl.textContent = remaining;
      }
    }
  }, 1000);
}

function generateValue() {
  return generateCredentialValue(
    state.generatorType,
    state.generatorOptions,
    state.generatorLanguage,
  );
}

function updateGeneratorOptions(event) {
  if (event.target.dataset.option)
    state.generatorOptions[event.target.dataset.option] = event.target.checked;
  if (event.target.id === "generator-length")
    state.generatorOptions.length = Math.min(
      128,
      Math.max(8, Number(event.target.value) || 20),
    );
  if (event.target.id === "generator-words")
    state.generatorOptions.words = Math.min(
      12,
      Math.max(5, Number(event.target.value) || 6),
    );
  if (event.target.id === "generator-separator")
    state.generatorOptions.separator = event.target.value;
  state.generatedValue = generateValue();
  const lengthValue = document.querySelector("#generator-length-value");
  if (lengthValue && event.target.id === "generator-length") {
    lengthValue.textContent = String(state.generatorOptions.length);
  }
  render();
}

async function copyGenerated() {
  const value = state.generatedValue || generateValue();
  state.generatedValue = value;
  if (
    await copySensitiveText(
      value,
      "Generació copiada.",
      document.querySelector("#copy-generated"),
    )
  ) {
    addHistory();
  }
}

let clipboardCleanupTimer = null;

async function copySensitiveText(value, successMessage, button = null) {
  try {
    await navigator.clipboard.writeText(value);
  } catch (error) {
    showToast(`No s'ha pogut copiar: ${error}`);
    return false;
  }

  clearTimeout(clipboardCleanupTimer);
  clipboardCleanupTimer = setTimeout(async () => {
    try {
      const current = await navigator.clipboard.readText();
      if (current === value) {
        await navigator.clipboard.writeText("");
      }
    } catch (e) {
      // readText not available; try clearing anyway
      try {
        await navigator.clipboard.writeText("");
      } catch (clearError) {
        // Failed to clear; silently give up
      }
    }
  }, 30_000);

  const feedbackTarget = button?.id
    ? `#${CSS.escape(button.id)}`
    : button?.dataset.copy
      ? `[data-copy="${CSS.escape(button.dataset.copy)}"]`
      : null;
  showToast(successMessage + " S'esborrarà del portapapers en 30 s.");
  const feedbackButton = feedbackTarget
    ? document.querySelector(feedbackTarget)
    : null;
  if (feedbackButton) {
    feedbackButton.classList.remove("is-copied");
    void feedbackButton.offsetWidth;
    feedbackButton.classList.add("is-copied");
    clearTimeout(feedbackButton.copyFeedbackTimer);
    feedbackButton.copyFeedbackTimer = setTimeout(
      () => feedbackButton.classList.remove("is-copied"),
      2100,
    );
  }
  return true;
}

function addHistory() {
  const value = state.generatedValue;
  if (!value) return;
  state.history = [
    {
      id: crypto.randomUUID(),
      type:
        state.generatorType === "password"
          ? "Contrasenya"
          : state.generatorType === "passphrase"
            ? "Frase de pas"
            : "Nom d'usuari",
      value,
      language: state.generatorLanguage,
      createdAt: new Date().toISOString(),
    },
    ...state.history,
  ].slice(0, 50);
  saveVault().catch((error) => showToast(String(error)));
}

function clearHistory() {
  state.history = [];
  saveVault()
    .then(() => {
      render();
      showToast("Historial buit.");
    })
    .catch((error) => showToast(String(error)));
}

function updateEntryStrength(password) {
  const meter = document.querySelector("#entry-password-strength");
  if (!meter) return;
  meter.hidden = !password;
  if (!password) return;
  const strength = passwordStrength(password);
  meter.dataset.strength = strength.level;
  meter.querySelector(".strength-fill").className =
    `strength-fill strength-${strength.level} strength-width-${strength.percent}`;
  meter.querySelector("strong").textContent = strength.label;
  meter.querySelector("small").textContent = strength.hint;
}

async function unlock(event) {
  event.preventDefault();
  if (!isTauriRuntime()) {
    state.error =
      "Obre SherLock amb `Obrir_SherLock.command` per crear o desbloquejar.";
    render();
    return;
  }
  const input = document.querySelector("#master-password");
  let masterPassword = input.value;
  state.error = "";
  state.loading = true;
  render();
  try {
    const result = await invoke("unlock_vault", { masterPassword });
    masterPassword = "";
    if (input) input.value = "";
    document.querySelector("#master-password")?.setAttribute("value", "");
    state.entries = (result.entries || []).map(mapVaultEntry);
    state.history = result.history || [];
    state.trash = result.trash || [];
    state.folders = result.folders || [];
    state.activeFolderId = "";
    state.locked = false;
    resetAutoLock();
    const isNewVault = Boolean(result.isNew ?? result.is_new);
    if (isNewVault) {
      state.firstEntryGuideStep = 1;
      const defaultFolders = [
        {
          id: "default",
          name: "Tots els elements",
          icon: "ShieldCheck",
          color: "#2563eb",
        },
        { id: "favorits", name: "Favorits", icon: "Star", color: "#fbbf24" },
        { id: "social", name: "Social", icon: "Heart", color: "#ec4899" },
      ];
      state.folders = defaultFolders;
      await saveVault(true);
      state.showFirstEntryGuide = true;
    }
  } catch (error) {
    state.error = String(error);
  } finally {
    masterPassword = "";
    if (input) input.value = "";
    state.loading = false;
    render();
    document.querySelector("#master-password")?.setAttribute("value", "");
  }
}

async function checkGridAuth() {
  try {
    const result = await invoke("get_auth_info");
    return result.exists;
  } catch {
    return false;
  }
}

async function saveVault(syncToRailway = false, backupExisting = false) {
  const entries = state.entries.map((e) => ({
    id: e.id,
    site: e.site,
    username: e.username,
    password: e.password,
    notes: e.notes,
    folder_id: e.folderId || null,
    created_at: e.createdAt,
    updated_at: e.updatedAt || null,
  }));

  const folders = state.folders.map((f) => ({
    id: f.id,
    name: f.name,
    icon: f.icon,
    color: f.color,
  }));

  const trash = state.trash.map((t) => ({
    id: t.id,
    site: t.site,
    username: t.username,
    password: t.password,
    notes: t.notes,
    folder_id: t.folderId || null,
    created_at: t.createdAt,
    updated_at: t.updatedAt || null,
    deleted_at: t.deletedAt,
  }));

  const history = state.history.map((h) => ({
    id: h.id,
    kind: h.type,
    value: h.value,
    language: h.language,
    created_at: h.createdAt,
  }));

  try {
    await invoke("save_vault", {
      entries,
      history,
      trash,
      folders,
      syncToRailway,
      backupExisting,
    });
  } catch (error) {
    showToast(`Error saving vault: ${error}`);
    throw error;
  }
}

async function persistImportedVault(entries, history, trash, folders) {
  const previous = {
    entries: state.entries,
    history: state.history,
    trash: state.trash,
    folders: state.folders,
  };
  state.entries = entries;
  state.history = history;
  state.trash = trash;
  state.folders = folders;
  try {
    await saveVault(false, true);
  } catch (error) {
    Object.assign(state, previous);
    throw error;
  }
}

function exportVault() {
  if (
    !confirm(
      "L'export conté les contrasenyes en text pla. Desa'l només en un lloc segur. Vols continuar?",
    )
  ) {
    return;
  }
  const payload = JSON.stringify(
    {
      version: 1,
      entries: state.entries,
      history: state.history,
      trash: state.trash,
      folders: state.folders,
    },
    null,
    2,
  );
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob([payload], { type: "application/json" }),
  );
  link.download = `sherlock-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("Còpia exportada. Desa-la en un lloc segur.");
}

async function importVault(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (
      !confirm(
        "La importació substituirà les dades actuals. Es crearà una còpia xifrada de la caixa abans de desar. Vols continuar?",
      )
    ) {
      return;
    }
    if (file.size > 5 * 1024 * 1024)
      throw new Error("El fitxer és massa gran (màxim 5 MB).");
    const text = await file.text();
    const isCsv =
      file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";
    const data = isCsv ? parseCsv(text) : JSON.parse(text);
    const records = Array.isArray(data) ? data : data.entries || data.items;
    const { entries, skipped } = normalizeImportedEntries(records);
    const history =
      !Array.isArray(data) && Array.isArray(data.history)
        ? data.history.slice(0, 50)
        : [];
    const trash =
      !Array.isArray(data) && Array.isArray(data.trash)
        ? normalizeImportedEntries(data.trash).entries
        : [];
    const folders = !Array.isArray(data)
      ? normalizeImportedFolders(data.folders, folderIcons, folderColors)
      : [];
    const folderIds = new Set(folders.map((folder) => folder.id));
    entries.forEach((entry) => {
      if (!folderIds.has(entry.folderId)) entry.folderId = "";
    });
    await persistImportedVault(entries, history, trash, folders);
    state.activeFolderId = "";
    state.view = "vault";
    showToast(
      `${entries.length} accessos importats${skipped ? `; ${skipped} ignorats perquè no eren vàlids` : ""}.`,
    );
  } catch (error) {
    showToast(`No s'ha pogut importar: ${error.message || error}`);
  } finally {
    event.target.value = "";
  }
}

function openViewEntry(id) {
  state.viewingEntryId = id;
  state.showEntryForm = false;
  render();
}

function closeViewEntry() {
  state.viewingEntryId = null;
  render();
}

function openNewEntry() {
  state.viewingEntryId = null;
  state.editingEntryId = null;
  state.entryFormDraft = null;
  state.returnToEntryForm = false;
  state.showEntryForm = true;
  state.formError = "";
  render();
  document.querySelector("#entry-name")?.focus();
}

function openEditEntry(id) {
  state.viewingEntryId = null;
  state.editingEntryId = id;
  state.entryFormDraft = null;
  state.returnToEntryForm = false;
  state.showEntryForm = true;
  state.formError = "";
  render();
  document.querySelector("#entry-name")?.focus();
}

function closeEntryForm() {
  if (!state.saving) {
    state.showEntryForm = false;
    state.editingEntryId = null;
    state.entryFormDraft = null;
    state.returnToEntryForm = false;
    state.formError = "";
    render();
  }
}

function openFolderModal(folderId = null) {
  state.editingFolderId = folderId;
  state.folderFormError = "";
  state.showFolderModal = true;
  render();
}

function closeFolderModal() {
  state.showFolderModal = false;
  state.editingFolderId = null;
  state.folderFormError = "";
  render();
}

async function saveFolder(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const name = String(form.get("name") || "").trim();
  const iconName = String(form.get("icon") || "Folder");
  const color = String(form.get("color") || folderColors[0]);
  if (!name) {
    state.folderFormError = "El nom de la carpeta és obligatori.";
    render();
    return;
  }
  if (
    state.folders.some(
      (folder) =>
        folder.name.toLowerCase() === name.toLowerCase() &&
        folder.id !== state.editingFolderId,
    )
  ) {
    state.folderFormError = "Ja existeix una carpeta amb aquest nom.";
    render();
    return;
  }
  const previousFolders = state.folders;
  let id = state.editingFolderId;
  if (id) {
    state.folders = state.folders.map((folder) =>
      folder.id === id ? { ...folder, name, icon: iconName, color } : folder,
    );
  } else {
    id = crypto.randomUUID();
    state.folders = [...state.folders, { id, name, icon: iconName, color }];
  }
  try {
    await saveVault();
    state.activeFolderId = id;
    closeFolderModal();
    showToast("Carpeta desada correctament.");
  } catch (error) {
    state.folders = previousFolders;
    state.folderFormError = String(error);
    render();
  }
}

async function saveEntry(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const name = String(form.get("name") || "").trim();
  const username = String(form.get("username") || "").trim();
  const password = String(form.get("password") || "");
  const url = String(form.get("url") || "").trim();
  const notes = String(form.get("notes") || "").trim();
  const folderId = String(form.get("folder") || "");

  if (!name || !password) {
    state.formError = "El nom i la contrasenya són obligatoris.";
    render();
    return;
  }

  state.saving = true;
  state.formError = "";
  render();
  const now = new Date().toISOString();

  if (state.editingEntryId) {
    const existingIndex = state.entries.findIndex(
      (e) => e.id === state.editingEntryId,
    );
    if (existingIndex !== -1) {
      try {
        const updatedEntry = await invoke("update_entry", {
          entryId: state.editingEntryId,
          site: name,
          username,
          password,
          notes: url ? `URL: ${url}${notes ? `\n${notes}` : ""}` : notes,
          folderId: folderId || null,
        });
        state.entries[existingIndex] = {
          ...state.entries[existingIndex],
          site: name,
          username,
          password,
          notes: url ? `URL: ${url}${notes ? `\n${notes}` : ""}` : notes,
          folderId: folderId || "",
          updatedAt: updatedEntry.updated_at || now,
        };
        state.showEntryForm = false;
        state.editingEntryId = null;
        state.saving = false;
        render();
        showToast("Accés actualitzat correctament.");
        return;
      } catch (error) {
        state.saving = false;
        state.formError = String(error);
        render();
        return;
      }
    }
  }

  const entry = {
    id: crypto.randomUUID(),
    site: name,
    username,
    password,
    notes: url ? `URL: ${url}${notes ? `\n${notes}` : ""}` : notes,
    folderId,
    createdAt: now,
    updatedAt: now,
  };

  state.entries.push(entry);
  try {
    await saveVault(); // Save encrypted vault after creation
    state.showEntryForm = false;
    state.editingEntryId = null;
    state.showFirstEntryGuide = false;
    state.saving = false;
    render();
    showToast("Accés desat de forma xifrada.");
  } catch (error) {
    state.entries.pop();
    state.saving = false;
    state.formError = String(error);
    render();
  }
}

async function copyEntry(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;
  await copySensitiveText(entry.password, "Contrasenya copiada.");
}

async function deleteEntryToTrash(id) {
  const entryIndex = state.entries.findIndex((item) => item.id === id);
  if (entryIndex === -1) return;
  const [removed] = state.entries.splice(entryIndex, 1);
  state.trash.unshift({
    ...removed,
    deletedAt: new Date().toISOString(),
  });
  state.viewingEntryId = null;
  try {
    await saveVault();
    render();
    showToast("Accés mogut a la paperera.");
  } catch (error) {
    state.entries.splice(entryIndex, 0, removed);
    state.trash.shift();
    render();
    showToast(`Error: ${error}`);
  }
}

async function restoreEntryFromTrash(id) {
  const index = state.trash.findIndex((item) => item.id === id);
  if (index === -1) return;
  const [restored] = state.trash.splice(index, 1);
  delete restored.deletedAt;
  state.entries.unshift(restored);
  try {
    await saveVault();
    render();
    showToast("Accés restaurat correctament.");
  } catch (error) {
    state.trash.splice(index, 0, restored);
    state.entries.shift();
    render();
    showToast(`Error: ${error}`);
  }
}

async function deletePermanentlyFromTrash(id) {
  const index = state.trash.findIndex((item) => item.id === id);
  if (index === -1) return;
  const [deleted] = state.trash.splice(index, 1);
  try {
    await saveVault();
    render();
    showToast("Accés eliminat definitivament.");
  } catch (error) {
    state.trash.splice(index, 0, deleted);
    render();
    showToast(`Error: ${error}`);
  }
}

async function emptyTrash() {
  if (!state.trash.length) return;
  const backup = [...state.trash];
  state.trash = [];
  try {
    await saveVault();
    render();
    showToast("Paperera buidada.");
  } catch (error) {
    state.trash = backup;
    render();
    showToast(`Error: ${error}`);
  }
}

function captureEntryFormDraft() {
  const form = document.querySelector("#entry-form");
  if (!form) return state.entryFormDraft || {};

  const formData = new FormData(form);
  return {
    site: String(formData.get("name") || ""),
    folderId: String(formData.get("folder") || ""),
    username: String(formData.get("username") || ""),
    password: String(formData.get("password") || ""),
    url: String(formData.get("url") || ""),
    notes: String(formData.get("notes") || ""),
  };
}

function openPasswordGenerator() {
  state.entryFormDraft = captureEntryFormDraft();
  state.showEntryForm = false;
  state.returnToEntryForm = true;
  if (state.showFirstEntryGuide) state.firstEntryGuideStep = 4;
  state.generatorType = "password";
  state.generatedValue = generateValue();
  state.view = "generator";
  render();
}

function useGeneratedPassword() {
  state.entryFormDraft = {
    ...(state.entryFormDraft || {}),
    password: state.generatedValue,
  };
  state.showEntryForm = true;
  state.returnToEntryForm = false;
  if (state.showFirstEntryGuide) state.firstEntryGuideStep = 5;
  state.view = "vault";
  render();
  const input = document.querySelector("#entry-password");
  if (input) {
    input.value = state.generatedValue;
    input.closest(".input-with-actions")?.classList.add("has-password");
    input.focus();
    updateEntryStrength(input.value);
  }
}

function bindEvents() {
  document.querySelector("#unlock-form")?.addEventListener("submit", unlock);
  document.querySelector("#next-welcome")?.addEventListener("click", () => {
    const lastWelcomeStep = 2;
    if (state.welcomeStep < lastWelcomeStep) {
      state.welcomeStep += 1;
      render();
      return;
    }
    state.showWelcome = false;
    render();
    document.querySelector("#master-password")?.focus();
  });

  document
    .querySelector("#auth-method-password")
    ?.addEventListener("click", () => {
      state.authMethodSelected = "password";
      render();
    });
  document
    .querySelector("#auth-method-image")
    ?.addEventListener("click", () => {
      state.authMethodSelected = "image";
      render();
    });
  document
    .querySelector("#auth-method-cloud-download")
    ?.addEventListener("click", () => {
      state.showCloudLogin = true;
      state.cloudTab = "login";
      state.cloudLoading = false;
      state.cloudError = "";
      render();
    });
  document
    .querySelector("#continue-auth-selection")
    ?.addEventListener("click", async () => {
      if (state.authMethodSelected === "password") {
        state.showAuthMethodSelection = false;
        render();
      } else if (state.authMethodSelected === "image") {
        state.showGridSetup = true;
        state.changingAuthMethod = false;
        state.imageGridPattern = [];
        state.imageGridBrushPath = [];
        state.gridSetupError = "";
        state.imageAuthImage = "";
        imageAuthRenderSource = "";
        render();
      }
    });
  document
    .querySelector("#image-upload-area")
    ?.addEventListener("click", () => {
      document.querySelector("#image-auth-upload")?.click();
    });

  document
    .querySelector("#image-auth-upload")
    ?.addEventListener("change", (event) => {
      const file = event.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          state.imageAuthImage = e.target.result;
          state.imageGridPattern = [];
          state.imageGridBrushPath = [];
          imageAuthRenderSource = "";
          document.querySelector("#image-upload-area").hidden = true;
          document.querySelector("#image-auth-canvas-area").hidden = false;
          renderImageOnCanvas();
        };
        reader.readAsDataURL(file);
      }
    });

  if (state.showGridSetup && state.imageAuthImage) {
    const uploadArea = document.querySelector("#image-upload-area");
    const canvasArea = document.querySelector("#image-auth-canvas-area");
    if (uploadArea) uploadArea.hidden = true;
    if (canvasArea) canvasArea.hidden = false;
    renderImageOnCanvas();
    updateImageAuthOrder(
      "image-auth-count",
      "image-auth-order",
      state.imageGridPattern,
    );
  }

  const imageSetupCanvas = document.querySelector("#image-auth-canvas");
  imageSetupCanvas?.addEventListener("pointerdown", (event) => {
    state.imageGridPointerActive = true;
    if (state.imageGridBrushPath.length) state.imageGridBrushPath.push(null);
    imageSetupCanvas.setPointerCapture(event.pointerId);
    selectImageGridCell(
      event,
      state.imageGridPattern,
      "image-auth-count",
      "image-auth-order",
      state.imageGridBrushPath,
    );
  });
  imageSetupCanvas?.addEventListener("pointermove", (event) => {
    if (state.imageGridPointerActive) {
      selectImageGridCell(
        event,
        state.imageGridPattern,
        "image-auth-count",
        "image-auth-order",
        state.imageGridBrushPath,
      );
    }
  });
  imageSetupCanvas?.addEventListener("pointerup", () => {
    state.imageGridPointerActive = false;
  });
  imageSetupCanvas?.addEventListener("pointercancel", () => {
    state.imageGridPointerActive = false;
  });

  document
    .querySelector("#undo-image-auth-point")
    ?.addEventListener("click", () => {
      state.imageGridPattern.pop();
      redrawImageAuthGridCanvas(
        "image-auth-canvas",
        state.imageGridPattern,
        "image-auth-count",
        "image-auth-order",
        state.imageGridBrushPath,
      );
    });

  document
    .querySelector("#clear-image-auth-points")
    ?.addEventListener("click", () => {
      state.imageGridPattern = [];
      state.imageGridBrushPath = [];
      redrawImageAuthGridCanvas(
        "image-auth-canvas",
        state.imageGridPattern,
        "image-auth-count",
        "image-auth-order",
        state.imageGridBrushPath,
      );
    });

  document
    .querySelector("#save-image-auth-setup")
    ?.addEventListener("click", async () => {
      if (!state.imageAuthImage) {
        state.gridSetupError = "Puja una imatge abans de desar la graella.";
        render();
        return;
      }
      if (state.imageGridPattern.length < 12) {
        state.gridSetupError = "Has de seleccionar almenys 12 punts.";
        render();
        return;
      }
      try {
        if (state.changingAuthMethod) {
          const result = await invoke("change_vault_to_image_grid", {
            selectedCells: state.imageGridPattern,
            imageData: state.imageAuthImage,
          });
          state.entries = (result.entries || []).map(mapVaultEntry);
          state.history = result.history || [];
          state.trash = (result.trash || []).map((entry) => ({
            ...entry,
            folderId: entry.folder_id || entry.folderId || null,
            createdAt: entry.created_at || entry.createdAt,
            updatedAt: entry.updated_at || entry.updatedAt || null,
          }));
          state.folders = result.folders || [];
        } else {
          await invoke("set_image_grid_auth", {
            imageData: state.imageAuthImage,
            selectedCells: state.imageGridPattern,
          });
          await invoke("init_empty_grid_vault", {
            selectedCells: state.imageGridPattern,
          });
        }
        state.imageGridConfigured = true;
        state.locked = false;
        state.changingAuthMethod = false;
        state.showGridSetup = false;
        state.showAuthMethodSelection = false;
        showToast("Autenticació amb imatge configurada correctament.");
        render();
      } catch (error) {
        state.gridSetupError = String(error);
        render();
      }
    });

  document
    .querySelector("#cancel-image-auth-setup")
    ?.addEventListener("click", () => {
      const returningToChangeAuth = state.changingAuthMethod;
      state.showGridSetup = false;
      state.gridSetupError = "";
      state.imageGridPattern = [];
      state.imageAuthImage = "";
      state.imageGridConfigured = false;
      state.showChangeAuthModal = returningToChangeAuth;
      state.changingAuthMethod = false;
      imageAuthRenderSource = "";
      if (!returningToChangeAuth) {
      }
      render();
    });

  document
    .querySelector("#cancel-image-auth-setup-bottom")
    ?.addEventListener("click", () => {
      state.showGridSetup = false;
      state.gridSetupError = "";
      state.imageGridPattern = [];
      state.imageAuthImage = "";
      state.showChangeAuthModal = state.changingAuthMethod;
      state.changingAuthMethod = false;
      imageAuthRenderSource = "";
      render();
    });

  document
    .querySelector("#cancel-image-auth-unlock")
    ?.addEventListener("click", () => {
      state.showGridUnlock = false;
      state.gridUnlockError = "";
      state.imageGridPattern = [];
      state.imageUnlockBrushPath = [];
      render();
    });

  document
    .querySelector("#cancel-image-auth-unlock-bottom")
    ?.addEventListener("click", () => {
      state.showGridUnlock = false;
      state.gridUnlockError = "";
      state.imageGridPattern = [];
      state.imageUnlockBrushPath = [];
      render();
    });

  const unlockCanvas = document.querySelector("#image-auth-unlock-canvas");
  if (unlockCanvas) {
    const persistedImage = state.imageAuthImage;
    if (persistedImage) {
      const img = new Image();
      img.onload = () => {
        drawImageAuthBackground(unlockCanvas, img);
        drawImageAuthGrid(
          unlockCanvas,
          state.imageGridPattern,
          state.imageUnlockBrushPath,
        );
      };
      img.src = persistedImage;
    }
  }

  const imageUnlockCanvas = document.querySelector("#image-auth-unlock-canvas");
  imageUnlockCanvas?.addEventListener("pointerdown", (event) => {
    if (!state.imageGridConfigured) return;
    state.imageGridPointerActive = true;
    if (state.imageUnlockBrushPath.length) {
      state.imageUnlockBrushPath.push(null);
    }
    imageUnlockCanvas.setPointerCapture(event.pointerId);
    selectImageGridCell(
      event,
      state.imageGridPattern,
      "image-auth-unlock-count",
      "image-auth-unlock-order",
      state.imageUnlockBrushPath,
    );
  });
  imageUnlockCanvas?.addEventListener("pointermove", (event) => {
    if (state.imageGridConfigured && state.imageGridPointerActive) {
      selectImageGridCell(
        event,
        state.imageGridPattern,
        "image-auth-unlock-count",
        "image-auth-unlock-order",
        state.imageUnlockBrushPath,
      );
    }
  });
  imageUnlockCanvas?.addEventListener("pointerup", () => {
    state.imageGridPointerActive = false;
  });
  imageUnlockCanvas?.addEventListener("pointercancel", () => {
    state.imageGridPointerActive = false;
  });

  document
    .querySelector("#undo-image-auth-unlock-point")
    ?.addEventListener("click", () => {
      state.imageGridPattern.pop();
      redrawImageAuthGridCanvas(
        "image-auth-unlock-canvas",
        state.imageGridPattern,
        "image-auth-unlock-count",
        "image-auth-unlock-order",
        state.imageUnlockBrushPath,
      );
    });

  document
    .querySelector("#clear-image-auth-unlock-points")
    ?.addEventListener("click", () => {
      state.imageGridPattern = [];
      state.imageUnlockBrushPath = [];
      redrawImageAuthGridCanvas(
        "image-auth-unlock-canvas",
        state.imageGridPattern,
        "image-auth-unlock-count",
        "image-auth-unlock-order",
        state.imageUnlockBrushPath,
      );
    });

  document
    .querySelector("#verify-image-auth-unlock")
    ?.addEventListener("click", async () => {
      const selectedCells = state.imageGridPattern;
      if (selectedCells.length < 12) {
        state.gridUnlockError = "Selecciona els 12 punts en el mateix ordre.";
        render();
        return;
      }
      state.loading = true;
      render();
      try {
        const result = await invoke("unlock_vault_grid", {
          pattern: selectedCells.slice(),
        });
        state.entries = (result.entries || []).map(mapVaultEntry);
        state.history = result.history || [];
        state.trash = result.trash || [];
        state.folders = result.folders || [];
        state.activeFolderId = "";
        state.locked = false;
        state.showGridUnlock = false;
        state.imageGridPattern = [];
        resetAutoLock();
      } catch (error) {
        state.gridUnlockError = String(error);
        state.imageGridPattern = [];
      } finally {
        state.loading = false;
        render();
      }
    });

  function drawImageAuthBackground(canvas, image) {
    const bitmapScale = Math.min(
      1,
      1400 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const bitmapWidth = Math.max(
      1,
      Math.round(image.naturalWidth * bitmapScale),
    );
    const bitmapHeight = Math.max(
      1,
      Math.round(image.naturalHeight * bitmapScale),
    );
    if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
      canvas.width = bitmapWidth;
      canvas.height = bitmapHeight;
    }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  }

  function withImageAuthBackground(canvas, drawOverlay) {
    const source = state.imageAuthImage;
    if (!source) return;
    const draw = (image) => {
      drawImageAuthBackground(canvas, image);
      drawOverlay(canvas.getContext("2d"));
    };
    if (source === imageAuthRenderSource && imageAuthRenderBitmap) {
      draw(imageAuthRenderBitmap);
      return;
    }
    imageAuthRenderSource = source;
    imageAuthRenderBitmap = null;
    const image = new Image();
    image.onload = () => {
      if (imageAuthRenderSource !== source) return;
      imageAuthRenderBitmap = image;
      draw(image);
    };
    image.src = source;
  }

  function drawImageAuthGrid(
    canvas,
    selectedCells,
    brushPath = [],
    animatedCell = -1,
    markerScale = 1,
  ) {
    withImageAuthBackground(canvas, (ctx) => {
      const cellWidth = canvas.width / 5;
      const cellHeight = canvas.height / 5;
      const displayScale = canvasDisplayScale(canvas);
      const selectedOrder = new Map(
        selectedCells.map((cell, index) => [cell, index + 1]),
      );
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      drawImageAuthBrushPath(ctx, canvas, brushPath, displayScale);
      for (const [cell, order] of selectedOrder) {
        const column = cell % 5;
        const row = Math.floor(cell / 5);
        const x = column * cellWidth;
        const y = row * cellHeight;
        const centerX = x + cellWidth / 2;
        const centerY = y + cellHeight / 2;
        const pointScale = cell === animatedCell ? markerScale : 1;
        const radius = 19 * displayScale * pointScale;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius + 3 * displayScale, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.fillStyle = "#078b68";
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = `700 ${15 * displayScale * pointScale}px 'DM Sans', sans-serif`;
        ctx.fillText(String(order), centerX, centerY);
      }
    });
  }

  function canvasDisplayScale(canvas) {
    const displayedWidth = canvas.getBoundingClientRect().width;
    return displayedWidth > 0 ? canvas.width / displayedWidth : 1;
  }

  function drawImageAuthBrushPath(ctx, canvas, brushPath, displayScale) {
    let previousPoint = null;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const point of brushPath) {
      if (!point) {
        previousPoint = null;
        continue;
      }
      const x = (point.x * canvas.width) / 100;
      const y = (point.y * canvas.height) / 100;
      if (previousPoint) {
        const previousX = (previousPoint.x * canvas.width) / 100;
        const previousY = (previousPoint.y * canvas.height) / 100;
        ctx.beginPath();
        ctx.moveTo(previousX, previousY);
        ctx.lineTo(x, y);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
        ctx.lineWidth = 8 * displayScale;
        ctx.stroke();
        ctx.strokeStyle = "#10b981";
        ctx.lineWidth = 5 * displayScale;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y, 7 * displayScale, 0, 2 * Math.PI);
      ctx.fillStyle = "#10b981";
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2 * displayScale;
      ctx.stroke();
      previousPoint = point;
    }
    ctx.restore();
  }

  function updateImageAuthOrder(countId, orderId, selectedCells) {
    document.getElementById(countId).textContent = selectedCells.length;
    document.getElementById(orderId).textContent = !selectedCells.length
      ? "cap"
      : selectedCells.map((_, index) => String(index + 1)).join(" → ");
  }

  function selectImageGridCell(
    event,
    selectedCells,
    countId,
    orderId,
    brushPath = [],
  ) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (x < 0 || x >= 1 || y < 0 || y >= 1) return;
    const cell = Math.floor(y * 5) * 5 + Math.floor(x * 5);
    const point = { x: x * 100, y: y * 100 };
    const previousPoint = brushPath.at(-1);
    if (
      !previousPoint ||
      Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y) >= 0.25
    ) {
      brushPath.push(point);
    }
    const isNewCell = !selectedCells.includes(cell);
    if (isNewCell) selectedCells.push(cell);
    if (
      countId === "image-auth-count" &&
      selectedCells.length >= 12 &&
      state.gridSetupError.startsWith("Has de seleccionar almenys 12")
    ) {
      state.gridSetupError = "";
      document.getElementById("image-auth-setup-error")?.remove();
    }
    drawImageAuthGrid(event.currentTarget, selectedCells, brushPath);
    if (isNewCell) {
      animateImageAuthCell(event.currentTarget, selectedCells, brushPath, cell);
    }
    updateImageAuthOrder(countId, orderId, selectedCells);
  }

  function animateImageAuthCell(canvas, selectedCells, brushPath, cell) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const duration = 260;
    const startedAt = performance.now();
    const animate = (now) => {
      if (!canvas.isConnected) return;
      const progress = Math.min((now - startedAt) / duration, 1);
      const offset = progress - 1;
      const eased = 1 + 2.2 * offset ** 3 + 1.2 * offset ** 2;
      const scale = 0.72 + eased * 0.28;
      drawImageAuthGrid(canvas, selectedCells, brushPath, cell, scale);
      if (progress < 1) requestAnimationFrame(animate);
      else drawImageAuthGrid(canvas, selectedCells, brushPath);
    };
    requestAnimationFrame(animate);
  }

  function redrawImageAuthGridCanvas(
    canvasId,
    selectedCells,
    countId,
    orderId,
    brushPath = [],
  ) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    drawImageAuthGrid(canvas, selectedCells, brushPath);
    updateImageAuthOrder(countId, orderId, selectedCells);
  }

  function renderImageOnCanvas() {
    const canvas = document.getElementById("image-auth-canvas");
    if (canvas) {
      drawImageAuthGrid(
        canvas,
        state.imageGridPattern,
        state.imageGridBrushPath,
      );
    }
  }
  document
    .querySelector("#change-auth-method")
    ?.addEventListener("click", () => {
      state.showChangeAuthModal = true;
      render();
    });
  document
    .querySelector("#change-auth-password")
    ?.addEventListener("click", () => {
      state.changeAuthSelected = "password";
      state.changeAuthError = "";
      render();
    });
  document
    .querySelector("#change-auth-image")
    ?.addEventListener("click", () => {
      state.changeAuthSelected = "image";
      state.changeAuthError = "";
      render();
    });
  document
    .querySelector("#save-auth-method")
    ?.addEventListener("click", async () => {
      if (state.changeAuthSelected === "image") {
        state.showGridSetup = true;
        state.imageGridPattern = [];
        state.imageGridBrushPath = [];
        state.gridSetupError = "";
        state.imageAuthImage = "";
        state.changingAuthMethod = true;
        imageAuthRenderSource = "";
        state.showChangeAuthModal = false;
        render();
        return;
      }

      const newPassword =
        document.querySelector("#change-auth-new-password")?.value || "";
      const confirmPassword =
        document.querySelector("#change-auth-confirm-password")?.value || "";
      const errorMessage =
        newPassword.length < 12
          ? "La contrasenya nova ha de tenir com a mínim 12 caràcters."
          : newPassword !== confirmPassword
            ? "Les contrasenyes no coincideixen."
            : "";
      if (errorMessage) {
        state.changeAuthError = errorMessage;
        const errorElement = document.querySelector("#change-auth-error");
        if (errorElement) {
          errorElement.textContent = errorMessage;
          errorElement.hidden = false;
        }
        return;
      }

      state.changeAuthBusy = true;
      const saveButton = document.querySelector("#save-auth-method");
      if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = "Canviant...";
      }
      try {
        await invoke("change_vault_to_password", {
          newPassword,
        });
        state.showChangeAuthModal = false;
        state.changeAuthError = "";
        state.changeAuthSelected = "password";
        showToast("Mètode d'autenticació canviat a contrasenya.");
        render();
      } catch (error) {
        state.changeAuthError = String(error);
        const errorElement = document.querySelector("#change-auth-error");
        if (errorElement) {
          errorElement.textContent = state.changeAuthError;
          errorElement.hidden = false;
        }
      } finally {
        state.changeAuthBusy = false;
        if (saveButton?.isConnected) {
          saveButton.disabled = false;
          saveButton.textContent = "Desa el mètode";
        }
      }
    });

  document
    .querySelectorAll("#cancel-change-auth, #cancel-change-auth-bottom")
    .forEach((button) =>
      button.addEventListener("click", () => {
        state.showChangeAuthModal = false;
        state.changeAuthError = "";
        render();
      }),
    );
  document
    .querySelectorAll("#dismiss-entry-guide, #dismiss-entry-guide-later")
    .forEach((button) =>
      button.addEventListener("click", () => {
        state.showFirstEntryGuide = false;
        render();
      }),
    );
  document
    .querySelector("#start-first-entry")
    ?.addEventListener("click", () => {
      state.showFirstEntryGuide = false;
      openNewEntry();
    });
  document.querySelector("#guide-next-step")?.addEventListener("click", () => {
    state.firstEntryGuideStep = 3;
    render();
  });
  document.querySelector("#open-entry-guide")?.addEventListener("click", () => {
    state.showFirstEntryGuide = true;
    state.firstEntryGuideStep = 1;
    render();
  });
  document.querySelector("#reveal-password")?.addEventListener("click", () => {
    const input = document.querySelector("#master-password");
    input.type = input.type === "password" ? "text" : "password";
  });
  document.querySelectorAll("#open-cloud-login").forEach((button) =>
    button.addEventListener("click", () => {
      state.cloudError = "";
      state.cloudUsernameAvailable = null;
      state.cloudUsernameChecking = false;
      state.cloudActionContext =
        button.dataset.context || (state.locked ? "download" : "settings");
      state.showCloudLogin = true;
      render();
    }),
  );
  document.querySelectorAll("#cancel-cloud-login").forEach((button) =>
    button.addEventListener("click", () => {
      state.showCloudLogin = false;
      state.cloudError = "";
      state.cloudUsernameAvailable = null;
      state.cloudUsernameChecking = false;
      render();
    }),
  );
  document
    .querySelector("#cloud-login-form")
    ?.addEventListener("submit", cloudAuthSubmit);

  document
    .querySelector("#download-password-form")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = document.querySelector("#download-password-input");
      if (!input) return;

      const password = input.value;
      if (!password) {
        document
          .querySelector("#download-password-error")
          ?.insertAdjacentHTML("beforeend", "<p>Contrasenya necessària</p>");
        return;
      }

      state.showDownloadPassword = false;
      state.downloadPassword = "";
      render();

      await downloadVaultFromCloud(password);
    });

  document
    .querySelector("#cancel-download-password-bottom")
    ?.addEventListener("click", () => {
      state.showDownloadPassword = false;
      state.downloadPassword = "";
      state.cloudError = "";
      render();
    });

  document
    .querySelector("#cancel-download-password")
    ?.addEventListener("click", () => {
      state.showDownloadPassword = false;
      state.downloadPassword = "";
      state.cloudError = "";
      render();
    });

  document.querySelector("#tab-cloud-login")?.addEventListener("click", () => {
    state.cloudTab = "login";
    state.cloudError = "";
    state.cloudUsernameAvailable = null;
    state.cloudUsernameChecking = false;
    render();
  });
  document
    .querySelector("#tab-cloud-register")
    ?.addEventListener("click", () => {
      state.cloudTab = "register";
      state.cloudError = "";
      state.cloudUsernameAvailable = null;
      state.cloudUsernameChecking = false;
      render();
    });
  document
    .querySelector("#toggle-cloud-advanced")
    ?.addEventListener("click", () => {
      state.cloudShowAdvanced = !state.cloudShowAdvanced;
      render();
    });
  document
    .querySelector("#reveal-cloud-password")
    ?.addEventListener("click", () => {
      const input = document.querySelector("#auth-password");
      if (input) input.type = input.type === "password" ? "text" : "password";
    });

  // Check username availability on blur (register tab only)
  document.querySelector("#auth-username")?.addEventListener("input", (event) => {
    state.cloudFormUsername = event.currentTarget.value;
    state.cloudUsernameAvailable = null;
    state.cloudUsernameCheckError = "";
  });
  document
    .querySelector("#auth-username")
    ?.addEventListener("blur", checkUsernameAvailability);

  document
    .querySelector("#btn-cloud-sync-now")
    ?.addEventListener("click", handleCloudSyncNow);
  document
    .querySelector("#btn-cloud-download-now")
    ?.addEventListener("click", handleCloudDownloadNow);
  document
    .querySelector("#btn-cloud-logout")
    ?.addEventListener("click", handleCloudLogout);

  document
    .querySelector("#btn-cloud-sync-modal")
    ?.addEventListener("click", handleCloudSyncNow);
  document
    .querySelector("#btn-cloud-download-modal")
    ?.addEventListener("click", handleCloudDownloadNow);
  document
    .querySelector("#btn-cloud-logout-modal")
    ?.addEventListener("click", handleCloudLogout);
  document
    .querySelector("#reset-vault")
    ?.addEventListener("click", resetLocalVault);

  document
    .querySelector("#generate-browser-pairing-code")
    ?.addEventListener("click", async () => {
      try {
        state.browserPairingCode = await invoke("generate_pairing_code");
        state.browserPairingExpiresAt = Date.now() + 120_000;
        startBrowserPairingMonitoring();
        render();
        showToast("Codi de vinculació creat.");
      } catch (error) {
        showToast(error?.toString?.() || "No s'ha pogut crear el codi.");
      }
    });

  document.querySelectorAll("[data-revoke-paired-browser]").forEach((button) =>
    button.addEventListener("click", async () => {
      try {
        await invoke("revoke_paired_client", {
          clientId: button.dataset.revokePairedBrowser,
        });
        state.browserPairingCode = "";
        await refreshPairedBrowsers();
        render();
        showToast("Navegador revocat.");
      } catch (error) {
        showToast(error?.toString?.() || "No s'ha pogut revocar el navegador.");
      }
    }),
  );

  document.querySelector("#search")?.addEventListener("input", (event) => {
    state.query = event.target.value.toLowerCase();
    render();
    const search = document.querySelector("#search");
    search?.focus();
    search?.setSelectionRange(search.value.length, search.value.length);
  });

  document
    .querySelector("#palette-search")
    ?.addEventListener("input", (event) => {
      state.paletteQuery = event.target.value;
      state.paletteIndex = 0;
      state.paletteCopiedId = null;
      clearTimeout(paletteHideTimer);
      render();
      focusPaletteSearch();
    });
  document
    .querySelector("#palette-backdrop")
    ?.addEventListener("click", (event) => {
      if (event.target.id === "palette-backdrop") closeCommandPalette();
    });
  document.querySelectorAll("[data-palette-entry]").forEach((button) => {
    button.addEventListener("mouseenter", () => {
      state.paletteIndex = Array.from(button.parentElement.children).indexOf(
        button,
      );
      document
        .querySelectorAll("[data-palette-entry]")
        .forEach((item, index) => {
          item.classList.toggle("selected", index === state.paletteIndex);
          item.setAttribute(
            "aria-selected",
            String(index === state.paletteIndex),
          );
        });
    });
    button.addEventListener("click", () =>
      selectPaletteEntry(button.dataset.paletteEntry),
    );
  });

  document.querySelectorAll("[data-folder]").forEach((button) =>
    button.addEventListener("click", () => {
      state.activeFolderId = button.dataset.folder || "";
      render();
    }),
  );
  document
    .querySelector("#new-folder")
    ?.addEventListener("click", () => openFolderModal());
  document
    .querySelector("#edit-folder")
    ?.addEventListener("click", () => openFolderModal(state.activeFolderId));
  document
    .querySelector("#folder-form")
    ?.addEventListener("submit", saveFolder);
  document
    .querySelectorAll("#cancel-folder, #cancel-folder-bottom")
    .forEach((button) => button.addEventListener("click", closeFolderModal));
  document.querySelectorAll("[data-folder-icon]").forEach((button) =>
    button.addEventListener("click", () => {
      document.querySelector("#folder-icon").value = button.dataset.folderIcon;
      document
        .querySelectorAll("[data-folder-icon]")
        .forEach((item) => item.classList.toggle("selected", item === button));
    }),
  );
  document.querySelectorAll("[data-folder-color]").forEach((button) =>
    button.addEventListener("click", () => {
      document.querySelector("#folder-color").value =
        button.dataset.folderColor;
      document
        .querySelectorAll("[data-folder-color]")
        .forEach((item) => item.classList.toggle("selected", item === button));
    }),
  );

  document.querySelector("#nav-vault")?.addEventListener("click", () => {
    if (state.returnToEntryForm) {
      state.returnToEntryForm = false;
      state.showEntryForm = true;
    }
    state.view = "vault";
    stopBrowserPairingTimers();
    state.browserPairingCode = "";
    render();
  });
  document.querySelector("#nav-settings")?.addEventListener("click", () => {
    state.view = "settings";
    render();
    // Refresh browser list in background — don't block or re-render here.
    refreshPairedBrowsers().catch(() => {});
  });
  document.querySelector("#nav-generator")?.addEventListener("click", () => {
    state.generatorType = "password";
    state.generatedValue = state.generatedValue || generateValue();
    state.view = "generator";
    stopBrowserPairingTimers();
    state.browserPairingCode = "";
    render();
  });

  document
    .querySelector("#theme-setting")
    ?.addEventListener("change", (event) => {
      state.settings.theme = event.target.value;
      persistSettings();
    });

  const fontSlider = document.querySelector("#font-size-setting");
  if (fontSlider) {
    fontSlider.addEventListener("input", (event) => {
      const val = Number(event.target.value) || 16;
      state.settings.fontSize = String(val);
      document.documentElement.dataset.fontSize = String(val);
      const out = document.querySelector("#font-size-value");
      if (out) out.textContent = `${val} px`;
      localStorage.setItem("sherlock-settings", JSON.stringify(state.settings));
    });
  }

  document.querySelector("#auto-lock")?.addEventListener("change", (event) => {
    state.settings.autoLock = event.target.value;
    persistSettings();
    resetAutoLock();
    showToast("Temps de bloqueig automàtic actualitzat.");
  });

  document.querySelectorAll("[data-accent]").forEach((button) =>
    button.addEventListener("click", () => {
      state.settings.accent = button.dataset.accent;
      persistSettings();
    }),
  );

  document
    .querySelectorAll("#cancel-reset-vault, #cancel-reset-vault-bottom")
    .forEach((button) =>
      button.addEventListener("click", cancelResetLocalVault),
    );
  document
    .querySelector("#confirm-reset-vault")
    ?.addEventListener("click", confirmResetLocalVault);

  document.querySelector("#open-trash")?.addEventListener("click", () => {
    state.showTrashModal = true;
    render();
  });

  document
    .querySelectorAll("#close-trash, #close-trash-bottom")
    .forEach((btn) =>
      btn.addEventListener("click", () => {
        state.showTrashModal = false;
        render();
      }),
    );

  document
    .querySelector("#empty-trash-btn")
    ?.addEventListener("click", emptyTrash);

  document
    .querySelectorAll("[data-restore-trash]")
    .forEach((btn) =>
      btn.addEventListener("click", () =>
        restoreEntryFromTrash(btn.dataset.restoreTrash),
      ),
    );

  document
    .querySelectorAll("[data-delete-perm]")
    .forEach((btn) =>
      btn.addEventListener("click", () =>
        deletePermanentlyFromTrash(btn.dataset.deletePerm),
      ),
    );

  document
    .querySelector("#export-vault")
    ?.addEventListener("click", exportVault);
  document
    .querySelector("#import-vault")
    ?.addEventListener("click", () =>
      document.querySelector("#import-file")?.click(),
    );
  document
    .querySelector("#import-file")
    ?.addEventListener("change", importVault);

  // Generador de credencials

  const generatedOutput = document.querySelector(".generated-card output");
  generatedOutput?.addEventListener("dragstart", (event) => {
    const value = generatedOutput.textContent?.trim();
    if (!value || !event.dataTransfer) return;
    event.dataTransfer.setData("text/plain", value);
    event.dataTransfer.effectAllowed = "copy";
    generatedOutput.classList.add("is-dragging");
  });
  generatedOutput?.addEventListener("dragend", () => {
    generatedOutput.classList.remove("is-dragging");
  });

  document.querySelectorAll("[data-generator-type]").forEach((button) =>
    button.addEventListener("click", () => {
      state.generatorType = button.dataset.generatorType;
      state.generatedValue = generateValue();
      render();
    }),
  );

  document.querySelector("#regenerate")?.addEventListener("click", () => {
    state.generatedValue = generateValue();
    addHistory();
    render();
    const newBtn = document.querySelector("#regenerate");
    if (newBtn) {
      newBtn.classList.add("spinning");
      setTimeout(() => newBtn.classList.remove("spinning"), 450);
    }
  });

  document
    .querySelector("#copy-generated")
    ?.addEventListener("click", copyGenerated);
  document
    .querySelector("#use-generated")
    ?.addEventListener("click", useGeneratedPassword);
  document
    .querySelector("#clear-history")
    ?.addEventListener("click", clearHistory);

  document
    .querySelectorAll("[data-copy-history]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        copySensitiveText(
          button.dataset.copyHistory,
          "Generació copiada.",
        ).catch((error) => showToast(`No s'ha pogut copiar: ${error}`)),
      ),
    );

  document
    .querySelector("#generator-language")
    ?.addEventListener("change", (event) => {
      state.generatorLanguage = event.target.value;
      state.generatedValue = "";
      render();
    });

  document
    .querySelector("#generator-length")
    ?.addEventListener("input", updateGeneratorOptions);
  document
    .querySelector("#generator-words")
    ?.addEventListener("change", updateGeneratorOptions);
  document
    .querySelector("#generator-separator")
    ?.addEventListener("input", updateGeneratorOptions);
  document
    .querySelectorAll("[data-option]")
    .forEach((input) =>
      input.addEventListener("change", updateGeneratorOptions),
    );

  document
    .querySelectorAll("#new-entry, #empty-new, #nav-new")
    .forEach((button) =>
      button.addEventListener("click", () => {
        if (state.showFirstEntryGuide && button.id === "new-entry") {
          state.firstEntryGuideStep = 2;
        }
        openNewEntry();
      }),
    );

  document.querySelectorAll("[data-view-entry]").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest(".entry-actions")) return;
      openViewEntry(card.dataset.viewEntry);
    });
  });

  document.querySelectorAll("[data-view-action]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      openViewEntry(btn.dataset.viewAction);
    });
  });

  document
    .querySelector("#close-details")
    ?.addEventListener("click", closeViewEntry);
  document.querySelector("#edit-entry-btn")?.addEventListener("click", () => {
    if (state.viewingEntryId) openEditEntry(state.viewingEntryId);
  });
  document
    .querySelector("#edit-entry-bottom")
    ?.addEventListener("click", () => {
      if (state.viewingEntryId) openEditEntry(state.viewingEntryId);
    });
  document
    .querySelector("#delete-entry-btn")
    ?.addEventListener("click", async () => {
      if (state.viewingEntryId) await deleteEntryToTrash(state.viewingEntryId);
    });
  document
    .querySelector("#delete-entry-bottom")
    ?.addEventListener("click", async () => {
      if (state.viewingEntryId) await deleteEntryToTrash(state.viewingEntryId);
    });

  document
    .querySelector("#reveal-details-password")
    ?.addEventListener("click", () => {
      const input = document.querySelector("#details-password");
      if (input) {
        input.type = input.type === "password" ? "text" : "password";
      }
    });

  document.querySelectorAll("[data-copy-text]").forEach((button) =>
    button.addEventListener("click", () => {
      const text = button.dataset.copyText;
      if (text) copySensitiveText(text, "Copiat al porta-retalls.", button);
    }),
  );

  document.querySelector("#entry-form")?.addEventListener("submit", saveEntry);
  document
    .querySelector("#save-entry-top")
    ?.addEventListener("click", () =>
      document.querySelector("#entry-form")?.requestSubmit(),
    );
  document
    .querySelectorAll("#cancel-entry, #cancel-entry-bottom")
    .forEach((button) => button.addEventListener("click", closeEntryForm));

  document
    .querySelector("#entry-password-reveal")
    ?.addEventListener("click", (event) => {
      const input = document.querySelector("#entry-password");
      input.type = input.type === "password" ? "text" : "password";
      event.currentTarget.title =
        input.type === "password"
          ? "Mostrar contrasenya"
          : "Ocultar contrasenya";
    });

  document
    .querySelector("#generate-password")
    ?.addEventListener("click", openPasswordGenerator);
  document
    .querySelector("#entry-password")
    ?.addEventListener("input", (event) => {
      updateEntryStrength(event.target.value);
      event.target
        .closest(".input-with-actions")
        ?.classList.toggle("has-password", Boolean(event.target.value));
    });

  document.querySelectorAll("[data-copy]").forEach((button) =>
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      copyEntry(button.dataset.copy, button);
    }),
  );

  document.querySelectorAll("[data-open]").forEach((button) =>
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      const address = button.dataset.open;
      if (address) {
        const url =
          address.startsWith("http://") || address.startsWith("https://")
            ? address
            : `https://${address}`;
        window.open(url, "_blank");
      }
    }),
  );

  document
    .querySelector("#refresh-vault")
    ?.addEventListener("click", async () => {
      await reloadVaultEntries();
      showToast("SherLock actualitzat.");
    });

  document.querySelector("#lock-vault")?.addEventListener("click", async () => {
    await lockVault();
  });
}

try {
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if ((state.settings.theme || "auto") === "auto") {
        applySettings();
      }
    });
} catch {}

["pointerdown", "keydown", "touchstart"].forEach((eventName) =>
  window.addEventListener(eventName, resetAutoLock, { passive: true }),
);

window.addEventListener("keydown", (event) => {
  const isPaletteShortcut =
    (event.metaKey || event.ctrlKey) && event.shiftKey && event.code === "KeyP";
  if (isPaletteShortcut && !isTauriRuntime()) {
    event.preventDefault();
    state.showCommandPalette ? closeCommandPalette() : openCommandPalette();
    return;
  }
  if (!state.showCommandPalette) return;

  if (event.key === "Escape") {
    event.preventDefault();
    closeCommandPalette();
    return;
  }
  const results = [...document.querySelectorAll("[data-palette-entry]")];
  if (!results.length) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    state.paletteIndex =
      (state.paletteIndex + direction + results.length) % results.length;
    render();
    focusPaletteSearch();
  } else if (event.key === "Enter") {
    event.preventDefault();
    selectPaletteEntry(results[state.paletteIndex].dataset.paletteEntry);
  }
});
async function reloadVaultEntries() {
  if (state.locked) return;
  try {
    const vault = await invoke("get_vault_entries");
    if (vault && vault.entries) {
      state.entries = (vault.entries || []).map(mapVaultEntry);
      if (vault.folders) {
        state.folders = vault.folders.map((folder) => ({
          id: folder.id,
          name: folder.name,
          icon: folder.icon,
          color: folder.color,
        }));
      }
      render();
    }
  } catch (err) {}
}

listen("vault-updated", async () => {
  await reloadVaultEntries();
  showToast("SherLock sincronitzat amb l'extensió.");
}).catch(() => {});

listen("palette-shortcut", () => {
  if (state.locked) return;
  state.showCommandPalette ? closeCommandPalette() : openCommandPalette();
}).catch(() => {});

window.addEventListener("focus", () => {
  if (!state.locked) {
    reloadVaultEntries();
  }
});

initializeApp();

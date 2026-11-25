import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api.js";
import {
  cloudUsernameStatus,
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
  GENERATOR_DEFAULT_MIN_COUNT,
  GENERATOR_MAX_LENGTH,
  GENERATOR_MIN_LENGTH,
  MASTER_PASSWORD_MIN_LENGTH,
  clampGeneratorMinCount,
  generateValue as generateCredentialValue,
  generatorMinimumLength,
  passwordMeetsRequirements,
  passwordRequirements,
  passwordStrength,
  passwordStrengthMarkup,
} from "./generator.js";
import "./styles.css";
import "./secure.css";

let autoLockTimer;

let paletteHideTimer;
let cloudUsernameCheckSequence = 0;
let cloudUsernameCheckTimer = null;
let cloudUsernameChecked = { username: "", railwayUrl: "" };
let cloudPasswordMatchTimer = null;
let cloudPasswordMatchSequence = 0;

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
    const saved = JSON.parse(localStorage.getItem("sherlock-cloud") || "{}");
    const safe = {
      provider: saved.provider || "",
      railwayUrl: saved.railwayUrl || "",
      vaultId: saved.vaultId || "",
      authUser: saved.authUser || "",
      cloudVersion:
        typeof saved.cloudVersion === "number" ? saved.cloudVersion : null,
      lastSyncAt:
        typeof saved.lastSyncAt === "number" ? saved.lastSyncAt : null,
    };
    if (saved.token || saved.refreshToken || saved.refresh_token) {
      localStorage.setItem("sherlock-cloud", JSON.stringify(safe));
    }
    return safe;
  } catch {
    return {};
  }
})();

let lastLockedState = null;
let lastView = null;
let appDialogResolver = null;
let browserPairingPollingTimer = null;
let browserPairingExpirationTimer = null;

const state = {
  locked: true,
  vaultExists: null,
  showFirstEntryGuide: false,
  showSetupPreferences: false,
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
  showTrashHint: false,
  showResetConfirm: false,
  showFolderModal: false,
  editingFolderId: null,
  returnToEntryForm: false,
  settings: savedSettings,
  pairedBrowsers: [],
  browserPairingCode: "",
  cloudConfig: { railwayUrl: "", vaultId: "", token: "", ...savedCloudConfig },
  showCloudLogin: false,
  showPrivacyPolicy: false,
  cloudLoading: false,
  cloudError: "",
  cloudSyncStatus: { phase: "idle", text: "", at: null },
  cloudTab: "login",
  showDownloadPassword: false,
  downloadPassword: "",
  cloudActionContext: "settings",
  cloudShowAdvanced: false,
  cloudMoreOpen: false,
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
    minNumbers: GENERATOR_DEFAULT_MIN_COUNT,
    minSymbols: GENERATOR_DEFAULT_MIN_COUNT,
    words: 6,
    separator: "-",
    usernameFormat: "word",
    uppercaseInitial: false,
    removeAccents: false,
    onlyUnaccented: false,
  },
  appDialog: null,
  showChangeAuthModal: false,
  changeAuthBusy: false,
  changeAuthError: "",
};

const views = createViews(state);

function showToast(message) {
  state.toast = message;
  const appContainer = document.querySelector("#app");
  if (!appContainer) return;
  const existing = appContainer.querySelector(".toast");
  existing?.remove();
  if (message) {
    const el = document.createElement("div");
    el.className = "toast show";
    el.innerHTML = escapeHtml(message);
    appContainer.appendChild(el);
  }
  setTimeout(() => {
    const t = document.querySelector(".toast");
    if (t) t.remove();
    state.toast = "";
  }, 2400);
}

function askDialog(options) {
  if (state.appDialog || appDialogResolver) {
    return Promise.resolve({ confirmed: false, password: "" });
  }
  state.appDialog = options;
  render();
  return new Promise((resolve) => {
    appDialogResolver = resolve;
    requestAnimationFrame(() => focusAppDialog());
  });
}

function closeAppDialog(choice) {
  const password = state.appDialog?.passwordValue || "";
  const resolver = appDialogResolver;
  state.appDialog = null;
  appDialogResolver = null;
  render();
  if (resolver)
    resolver({
      confirmed: choice === true || choice === "third",
      password,
      choice:
        choice === true ? "confirm" : choice === false ? "cancel" : choice,
    });
}

function updateAppDialogConfirmButton() {
  if (!state.appDialog) return;
  const d = state.appDialog;
  const requireText = d.requireText || "";
  const passwordLabel = d.passwordLabel || "";
  const requireValue = d.requireTextValue || "";
  const passwordValue = d.passwordValue || "";
  const disabled =
    (requireText && requireValue !== requireText) ||
    (passwordLabel && passwordValue.length === 0);
  const btn = document.querySelector("#app-dialog-confirm");
  if (btn) btn.disabled = disabled;
}

function focusAppDialog() {
  if (!state.appDialog) return;
  const d = state.appDialog;
  const cancelBtn = document.querySelector("#app-dialog-cancel");
  const firstInput = document.querySelector(
    "#app-dialog-require-text, #app-dialog-password",
  );
  if (d.danger) {
    cancelBtn?.focus();
  } else if (firstInput) {
    firstInput.focus();
  } else {
    cancelBtn?.focus();
  }
}

function captureScroll() {
  const positions = {};
  for (const sel of [".settings-content", ".generator-content"]) {
    const el = document.querySelector(sel);
    if (el) positions[sel] = el.scrollTop;
  }
  return positions;
}

function restoreScroll(positions, prevView, prevLocked) {
  if (state.view !== prevView || state.locked !== prevLocked) return;
  for (const [sel, top] of Object.entries(positions)) {
    const el = document.querySelector(sel);
    if (el) el.scrollTop = Number(top);
  }
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
  state.showPrivacyPolicy = false;
  state.showSetupPreferences = false;
  state.showTrashHint = false;
  state.generatorType = "password";
  state.generatedValue = "";
  state.changeAuthError = "";
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
      state.error = "";
      state.showSetupPreferences = true;
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
    token: "",
    cloud_version:
      typeof config?.cloudVersion === "number" ? config.cloudVersion : null,
  };
}

function updateLocalCloudVersion(version) {
  if (typeof version === "number") {
    state.cloudConfig.cloudVersion = version;
    persistCloudMetadata();
  }
}

function persistCloudMetadata() {
  const {
    provider = "",
    railwayUrl = "",
    vaultId = "",
    authUser = "",
    cloudVersion = null,
    lastSyncAt = null,
  } = state.cloudConfig;
  localStorage.setItem(
    "sherlock-cloud",
    JSON.stringify({
      provider,
      railwayUrl,
      vaultId,
      authUser,
      cloudVersion,
      lastSyncAt,
    }),
  );
}

function updateLocalCloudLastSyncAt(at) {
  state.cloudConfig.lastSyncAt = at;
  persistCloudMetadata();
}

async function refreshCloudVersionFromBackend() {
  try {
    const version = await invoke("get_cloud_version");
    if (typeof version === "number") {
      updateLocalCloudVersion(version);
    }
  } catch (error) {
    console.warn("No s'ha pogut actualitzar la versió del núvol:", error);
  }
}

function updateCloudUsernameStatus() {
  const input = document.querySelector("#auth-username");
  if (!input) return;
  const view = cloudUsernameStatus({
    tab: state.cloudTab,
    checking: state.cloudUsernameChecking,
    available: state.cloudUsernameAvailable,
    error: state.cloudUsernameCheckError,
  });
  const status = document.querySelector("#auth-username-status");
  const hint = document.querySelector("#auth-username-hint");
  input
    .closest(".username-field")
    ?.classList.toggle("has-status", Boolean(view.label));
  input.classList.toggle("is-available", view.tone === "available");
  input.classList.toggle(
    "is-taken",
    view.tone === "taken" || view.tone === "error",
  );
  if (view.tone === "taken") {
    input.setAttribute("aria-invalid", "true");
  } else {
    input.removeAttribute("aria-invalid");
  }
  if (status) {
    status.textContent = view.label;
    status.className = `username-status is-${view.tone}`;
  }
  if (hint) {
    hint.textContent = view.hint;
    hint.className = `username-hint is-${view.tone}`;
    hint.hidden = !view.hint;
  }
}

function resetCloudUsernameCheck() {
  if (cloudUsernameCheckTimer) {
    clearTimeout(cloudUsernameCheckTimer);
    cloudUsernameCheckTimer = null;
  }
  cloudUsernameCheckSequence++;
  cloudUsernameChecked = { username: "", railwayUrl: "" };
  state.cloudUsernameChecking = false;
  state.cloudUsernameAvailable = null;
  state.cloudUsernameCheckError = "";
  updateCloudUsernameStatus();
}

function scheduleCloudUsernameCheck() {
  if (cloudUsernameCheckTimer) clearTimeout(cloudUsernameCheckTimer);
  cloudUsernameCheckTimer = setTimeout(() => {
    cloudUsernameCheckTimer = null;
    void checkUsernameAvailability();
  }, 450);
}

function setCloudError(message) {
  state.cloudError = message ? String(message) : "";
  const banner = document.querySelector("#cloud-error-banner");
  const text = document.querySelector("#cloud-error-text");
  if (banner && text) {
    banner.hidden = !state.cloudError;
    text.textContent = state.cloudError;
    return;
  }
  if (state.cloudError) render();
}

function resetCloudPasswordMatchCheck() {
  if (cloudPasswordMatchTimer) {
    clearTimeout(cloudPasswordMatchTimer);
    cloudPasswordMatchTimer = null;
  }
  cloudPasswordMatchSequence++;
  const warning = document.querySelector("#cloud-password-warning");
  if (warning) {
    warning.hidden = true;
    warning.textContent = "";
  }
  document.querySelector("#auth-password")?.removeAttribute("aria-invalid");
}

function updateCloudPasswordFeedback() {
  const passwordInput = document.querySelector("#auth-password");
  const feedback = document.querySelector("#cloud-password-feedback");
  if (!passwordInput || !feedback) return;

  const password = passwordInput.value;
  const confirm = document.querySelector("#auth-confirm-password")?.value || "";
  renderPasswordFeedback(feedback, password, confirm);
  resetCloudPasswordMatchCheck();

  if (
    state.cloudTab !== "register" ||
    state.locked ||
    !isTauriRuntime() ||
    [...password].length < MASTER_PASSWORD_MIN_LENGTH
  ) {
    return;
  }

  const sequence = cloudPasswordMatchSequence;
  cloudPasswordMatchTimer = setTimeout(async () => {
    cloudPasswordMatchTimer = null;
    try {
      const matches = await invoke("cloud_password_matches_master", {
        password,
      });
      if (sequence !== cloudPasswordMatchSequence) return;
      if (state.cloudTab !== "register") return;
      const warning = document.querySelector("#cloud-password-warning");
      if (!warning) return;
      if (matches) {
        warning.hidden = false;
        warning.textContent =
          "Aquesta contrasenya és la mateixa que la contrasenya mestra de la SherLock. Tria'n una de diferent.";
        passwordInput.setAttribute("aria-invalid", "true");
      } else {
        warning.hidden = true;
        warning.textContent = "";
        passwordInput.removeAttribute("aria-invalid");
      }
    } catch {
      // The registration command still rejects equality server-side.
    }
  }, 350);
}

async function checkUsernameAvailability({ force = false } = {}) {
  if (state.cloudTab !== "register") return null;
  if (cloudUsernameCheckTimer) {
    clearTimeout(cloudUsernameCheckTimer);
    cloudUsernameCheckTimer = null;
  }

  const input = document.querySelector("#auth-username");
  const username = input?.value.trim() || "";
  state.cloudFormUsername = username;
  const customUrl =
    document.querySelector("#cloud-railway-url")?.value.trim() || "";

  if (username.length < 3) {
    resetCloudUsernameCheck();
    return null;
  }

  // Reuse the last answer for the same username and server. This keeps a
  // blur right after the debounced check from firing a duplicate request.
  if (
    !force &&
    state.cloudUsernameAvailable !== null &&
    cloudUsernameChecked.username === username &&
    cloudUsernameChecked.railwayUrl === customUrl
  ) {
    updateCloudUsernameStatus();
    return state.cloudUsernameAvailable;
  }

  const checkSequence = ++cloudUsernameCheckSequence;
  cloudUsernameChecked = { username: "", railwayUrl: "" };
  state.cloudUsernameChecking = true;
  state.cloudUsernameAvailable = null;
  state.cloudUsernameCheckError = "";
  updateCloudUsernameStatus();

  try {
    const available = await invoke("check_railway_username", {
      username,
      railwayUrl: customUrl || null,
    });
    if (checkSequence !== cloudUsernameCheckSequence) return null;
    state.cloudUsernameAvailable = available === true;
    cloudUsernameChecked = { username, railwayUrl: customUrl };
    return state.cloudUsernameAvailable;
  } catch (error) {
    if (checkSequence !== cloudUsernameCheckSequence) return null;
    state.cloudUsernameAvailable = null;
    cloudUsernameChecked = { username: "", railwayUrl: "" };
    state.cloudUsernameCheckError = String(
      error || "No s'ha pogut comprovar el nom d'usuari.",
    );
    return null;
  } finally {
    if (checkSequence === cloudUsernameCheckSequence) {
      state.cloudUsernameChecking = false;
      updateCloudUsernameStatus();
    }
  }
}

async function cloudAuthSubmit(event) {
  event.preventDefault();
  setCloudError("");

  const username = document.querySelector("#auth-username")?.value.trim() || "";
  const password = document.querySelector("#auth-password")?.value || "";
  const customUrl =
    document.querySelector("#cloud-railway-url")?.value.trim() || "";
  const customVaultId =
    document.querySelector("#cloud-vault-id")?.value.trim() || "";

  if (!username) {
    setCloudError("Introdueix el teu nom d'usuari de Railway.");
    return;
  }
  if (!password) {
    setCloudError("Introdueix la contrasenya de Railway.");
    return;
  }

  const isRegister = state.cloudTab === "register";

  if (isRegister) {
    if (username.length < 3) {
      setCloudError("El nom d'usuari ha de tenir almenys 3 caràcters.");
      return;
    }

    // The server is authoritative, but never submit while the field still
    // shows an unavailable name. Await a fresh check when the debounced one
    // has not finished (or has never run).
    const usernameCheckIsCurrent =
      state.cloudUsernameAvailable === true &&
      cloudUsernameChecked.username === username &&
      cloudUsernameChecked.railwayUrl === customUrl;
    if (!usernameCheckIsCurrent) {
      await checkUsernameAvailability({ force: true });
    }
    if (state.cloudUsernameAvailable === false) {
      setCloudError("Aquest nom d'usuari ja existeix. Tria'n un altre.");
      document.querySelector("#auth-username")?.focus();
      return;
    }

    const confirmPassword =
      document.querySelector("#auth-confirm-password")?.value || "";
    const privacyAccepted =
      document.querySelector("#privacy-accepted")?.checked || false;

    if (password !== confirmPassword) {
      setCloudError("Les contrasenyes no coincideixen.");
      return;
    }
    if (!passwordMeetsRequirements(password)) {
      setCloudError(
        `La contrasenya de Railway ha de tenir com a mínim ${MASTER_PASSWORD_MIN_LENGTH} caràcters i incloure majúscules, minúscules, números i un caràcter especial.`,
      );
      document.querySelector("#auth-password")?.focus();
      return;
    }
    if (!privacyAccepted) {
      setCloudError(
        "Has d'acceptar la Política de Privacitat per registrar-te.",
      );
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
        authUser: authData.username,
      };

      state.cloudConfig = updatedConfig;
      persistCloudMetadata();

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
      setCloudError(error);
    } finally {
      state.cloudLoading = false;
      render();
    }
    return;
  }

  const isDownload = state.cloudActionContext === "download";
  const isSync = state.cloudActionContext === "sync";
  const masterPassword = state.locked
    ? document.querySelector("#auth-master-password")?.value || ""
    : null;

  if (isDownload && state.locked && !masterPassword) {
    setCloudError(
      "Introdueix la contrasenya mestra de la SherLock per desxifrar-la.",
    );
    return;
  }

  state.cloudLoading = true;
  render();

  try {
    const authData = await invoke("auth_official_cloud", {
      username,
      password,
      railwayUrl: customUrl || null,
      forDownload: isDownload,
    });

    const updatedConfig = {
      ...state.cloudConfig,
      provider: customUrl ? "custom" : "official",
      railwayUrl: customUrl,
      vaultId: customVaultId || authData.vault_id || "",
      authUser: authData.username,
    };

    state.cloudConfig = updatedConfig;
    persistCloudMetadata();

    if (isDownload) {
      const serialized = await invoke("sync_download_vault", {
        masterPassword,
        config: rustCloudConfig(updatedConfig),
      });
      await refreshCloudVersionFromBackend();

      const vault = JSON.parse(serialized);
      state.entries = (vault.entries || []).map(mapVaultEntry);
      state.entries.forEach((entry) => {
        if (entry.folderId === "default") entry.folderId = "";
      });
      state.folders = (vault.folders || []).filter(
        (folder) => folder.id !== "default",
      );
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
      state.showCloudLogin = false;
      if (isSync && !state.locked) {
        // Let the single sync decision path decide between upload, download
        // and conflict. Uploading straight after login could overwrite a
        // vault created on another device.
        await handleCloudSyncNow();
      } else {
        showToast(`Sessió iniciada a Railway com a ${authData.username}.`);
      }
    }
  } catch (error) {
    setCloudError(error);
  } finally {
    state.cloudLoading = false;
    render();
  }
}

async function handleCloudSyncNow() {
  if (!state.cloudConfig.authUser || !state.cloudConfig.vaultId) {
    state.showCloudLogin = true;
    state.cloudActionContext = "sync";
    resetCloudPasswordMatchCheck();
    render();
    return;
  }

  if (state.locked) {
    showToast("Desbloqueja la SherLock abans de sincronitzar-la.");
    return;
  }

  state.cloudSyncStatus = {
    phase: "syncing",
    text: "Sincronitzant…",
    at: null,
  };
  state.cloudLoading = true;
  render();

  let succeeded = false;
  try {
    const res = await invoke("sync_vault_auto", {
      config: rustCloudConfig(state.cloudConfig),
    });
    if (res && typeof res.version === "number") {
      updateLocalCloudVersion(res.version);
    }
    switch (res?.outcome) {
      case "up_to_date":
        state.cloudSyncStatus = {
          phase: "done",
          text: "Tot al dia.",
          at: null,
        };
        break;
      case "uploaded":
        state.cloudSyncStatus = {
          phase: "done",
          text: "Canvis desats al núvol.",
          at: null,
        };
        break;
      case "downloaded": {
        const downloaded = await invoke("get_vault_entries");
        applyDownloadedVault(downloaded);
        state.cloudSyncStatus = {
          phase: "done",
          text: "S'han baixat els canvis d'un altre dispositiu.",
          at: null,
        };
        break;
      }
      case "conflict": {
        state.cloudSyncStatus = { phase: "idle", text: "", at: null };
        render();
        const choice = await askDialog({
          title: "Hi ha canvis en dos llocs",
          message:
            "Has canviat la SherLock en aquest dispositiu i el núvol en té una altra còpia (potser d'un altre dispositiu). Només en pots conservar una.",
          confirmLabel: "Conservar la d'aquest dispositiu",
          confirmHelp: "Substituirà la còpia del núvol. No es pot desfer.",
          thirdLabel: "Conservar la del núvol",
          thirdHelp:
            "Substituirà la d'aquest dispositiu. En guardem una còpia de seguretat.",
          danger: false,
        });
        if (choice.choice === "confirm" || choice.choice === "third") {
          state.cloudSyncStatus = {
            phase: "syncing",
            text: "Sincronitzant…",
            at: null,
          };
          render();
          const resolved = await invoke("sync_resolve_conflict", {
            config: rustCloudConfig(state.cloudConfig),
            syncConfigArg: rustCloudConfig(state.cloudConfig),
            keep: choice.choice === "confirm" ? "local" : "cloud",
          });
          if (resolved?.outcome === "downloaded") {
            const downloaded = await invoke("get_vault_entries");
            applyDownloadedVault(downloaded);
          }
          if (resolved?.outcome === "conflict") {
            throw new Error(
              "Els canvis han tornat a entrar en conflicte. Torna-ho a provar.",
            );
          }
          if (
            !["downloaded", "uploaded", "up_to_date"].includes(
              resolved?.outcome,
            )
          ) {
            throw new Error(
              resolved?.error || "No s'ha pogut resoldre el conflicte.",
            );
          }
          if (typeof resolved.version === "number") {
            updateLocalCloudVersion(resolved.version);
          }
          state.cloudSyncStatus = {
            phase: "done",
            text:
              resolved.outcome === "downloaded"
                ? "S'han baixat els canvis d'un altre dispositiu."
                : resolved.outcome === "up_to_date"
                  ? "Tot al dia."
                  : "Canvis desats al núvol.",
            at: null,
          };
        }
        break;
      }
      default:
        throw new Error(
          res?.error || res?.message || "No s'ha pogut sincronitzar.",
        );
    }
    succeeded = true;
  } catch (err) {
    const rawMessage = String(err || "").replace(/^Error: /, "");
    const message = /[àèéíòóúç·]/i.test(rawMessage)
      ? rawMessage.split(/[\n(]/)[0]
      : "No s'ha pogut sincronitzar. Torna-ho a provar.";
    state.cloudSyncStatus = {
      phase: "error",
      text: message || "No s'ha pogut sincronitzar. Torna-ho a provar.",
      at: null,
    };
  } finally {
    state.cloudLoading = false;
    if (succeeded) {
      const at = Date.now();
      updateLocalCloudLastSyncAt(at);
      state.cloudSyncStatus.at = at;
    }
    render();
  }
}

/**
 * Aplica al estat en memòria una caixa descarregada del núbol.
 * Reutilitzat per `downloadVaultFromCloud` i per `sync_vault_auto` (outcome
 * "downloaded"). No toca el fitxer local: això ja ho fa la comanda Rust.
 */
function applyDownloadedVault(vault) {
  state.entries = (vault.entries || []).map((entry) =>
    entry.folderId === "default" ? { ...entry, folderId: "" } : entry,
  );
  state.folders = (vault.folders || []).filter(
    (folder) => folder.id !== "default",
  );
  state.trash = (vault.deleted_entries || vault.trash || []).map((entry) => ({
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
}

async function downloadVaultFromCloud(masterPassword) {
  state.cloudLoading = true;
  render();

  try {
    const serialized = await invoke("sync_download_vault", {
      masterPassword,
      config: rustCloudConfig(state.cloudConfig),
    });
    await refreshCloudVersionFromBackend();
    applyDownloadedVault(JSON.parse(serialized));
    showToast("SherLock descarregat i sincronitzada de Railway!");
  } catch (err) {
    showToast(`Error en descarregar de Railway: ${err}`);
  } finally {
    state.cloudLoading = false;
    render();
  }
}

async function handleCloudLogout() {
  const result = await askDialog({
    title: "Tancar la sessió a Railway?",
    message: "Les dades d'aquest dispositiu es mantenen intactes.",
    confirmLabel: "Tancar sessió",
    danger: true,
  });
  if (!result.confirmed) return;
  const config = rustCloudConfig(state.cloudConfig);
  try {
    await invoke("revoke_official_cloud_session", {
      railwayUrl: config.railway_url,
      vaultId: config.vault_id,
      token: config.token || null,
    });
  } catch (error) {
    showToast(
      `No s'ha pogut revocar la sessió al servidor, però es tancarà localment: ${error}`,
    );
  }
  // Neteja l'estat local igual (els errors del servidor no bloqueixen el logout local)
  state.cloudConfig = {
    railwayUrl: "",
    vaultId: "",
    token: "",
    authUser: "",
  };
  localStorage.removeItem("sherlock-cloud");
  try {
    await invoke("set_railway_sync_config", {
      railwayUrl: "",
      vaultId: "",
      token: "",
    });
  } catch (error) {
    console.error("No s'ha pogut netejar la configuració de Railway:", error);
    showToast(
      "Sessió tancada, però la configuració local no s'ha netejat del tot.",
    );
    render();
    return;
  }
  showToast("Sessió tancada a Railway.");
  render();
}

async function handleDeleteCloudAccount() {
  if (!state.cloudConfig.authUser || !state.cloudConfig.vaultId) {
    showToast("No hi ha cap sessió de cloud activa.");
    return;
  }

  const result = await askDialog({
    title: "Eliminar compte al núvol?",
    message:
      "Això eliminarà la teva SherLock xifrada del núvol i tancarà la sessió. No es pot desfer. Les dades d'aquest dispositiu no s'esborren.",
    confirmLabel: "Eliminar compte",
    danger: true,
    requireText: "ELIMINAR",
    passwordLabel: "Contrasenya mestra",
  });
  if (!result.confirmed) return;
  const masterPassword = result.password;

  const config = rustCloudConfig(state.cloudConfig);
  try {
    await invoke("delete_cloud_account", {
      masterPassword: masterPassword,
      config,
    });
  } catch (error) {
    showToast(`No s'ha pogut eliminar el compte al nuvol: ${error}`);
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
      railwayUrl: "",
      vaultId: "",
      token: "",
    });
  } catch (error) {
    console.error("No s'ha pogut netejar la configuració de Railway:", error);
    showToast(
      "Compte eliminat, però la configuració local no s'ha netejat del tot.",
    );
    render();
    return;
  }
  showToast("Compte i dades al nuvol eliminats.");
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
    state.error = "";
    state.showSetupPreferences = true;
    state.showTrashHint = false;
    state.firstEntryGuideStep = 1;
    state.view = "vault";
    state.showChangeAuthModal = false;
    state.changeAuthError = "";
    state.showCloudLogin = false;
    state.showPrivacyPolicy = false;
    showToast("Dades locals eliminades.");
  } catch (error) {
    showToast(`No s'han pogut eliminar les dades: ${error}`);
  }
  render();
}

function render() {
  const appContainer = document.querySelector("#app");
  if (!appContainer) return;

  const prevView = state.view;
  const prevLocked = state.locked;
  const scrollPositions = captureScroll();

  document.documentElement.dataset.locked = String(state.locked);

  let needsTransition = false;
  if (lastLockedState !== null && lastLockedState !== state.locked) {
    needsTransition = true;
  }
  lastLockedState = state.locked;

  const viewChanged = lastView !== null && lastView !== state.view;
  lastView = state.view;

  const viewMarkup = state.locked
    ? views.lockScreen()
    : state.view === "generator"
      ? views.generatorScreen()
      : state.view === "settings"
        ? views.settingsScreen()
        : views.vaultScreen();
  replaceMarkup(appContainer, viewMarkup);

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

  // View-fade-in animation: only on view change, never on every render
  const shell = appContainer.querySelector(
    ".lock-shell, .shell, .generator-shell, .settings-shell",
  );
  if (shell) {
    if (viewChanged) shell.classList.add("view-fade-in");
    else shell.classList.remove("view-fade-in");
  }

  if (!state.locked && state.showCommandPalette) {
    appendMarkup(appContainer, views.commandPalette());
  }
  if (!state.locked && state.toast) {
    const existing = appContainer.querySelector(".toast");
    if (!existing) {
      appendMarkup(
        appContainer,
        `<div class="toast show">${escapeHtml(state.toast)}</div>`,
      );
    }
  }

  createIcons({ icons });
  enhanceRenderedUi();
  applySettings();
  bindEvents();
  scheduleGuidePosition();

  restoreScroll(scrollPositions, prevView, prevLocked);
}

const GUIDE_TARGETS = {
  1: { selector: "#new-entry", prefer: "below", align: "right" },
  2: { selector: "#entry-name", prefer: "below", align: "left" },
  3: { selector: "#generate-password", prefer: "below", align: "right" },
  4: { selector: "#use-generated", prefer: "below", align: "center" },
  5: { selector: "#save-entry-bottom", prefer: "above", align: "right" },
};

let guidePositionFrame = 0;

function scheduleGuidePosition() {
  if (guidePositionFrame) return;
  guidePositionFrame = requestAnimationFrame(() => {
    guidePositionFrame = 0;
    positionGuideCallout();
  });
}

function positionGuideCallout() {
  const callout = document.querySelector(".guide-callout");
  if (!callout) return;
  const config = GUIDE_TARGETS[Number(state.firstEntryGuideStep)];
  const target = config ? document.querySelector(config.selector) : null;
  if (!target) return;

  const targetRect = target.getBoundingClientRect();
  if (!targetRect.width || !targetRect.height) return;
  const calloutRect = callout.getBoundingClientRect();
  const width = calloutRect.width;
  const height = calloutRect.height;
  const gap = 16;
  const edge = 16;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const centerX = targetRect.left + targetRect.width / 2;
  const centerY = targetRect.top + targetRect.height / 2;
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const alignLeft = () =>
    clamp(targetRect.left, edge, viewportWidth - width - edge);
  const alignRight = () =>
    clamp(targetRect.right - width, edge, viewportWidth - width - edge);
  const alignCenter = () =>
    clamp(centerX - width / 2, edge, viewportWidth - width - edge);
  const aligns = { left: alignLeft, right: alignRight, center: alignCenter };

  const below = {
    placement: "below",
    left: aligns[config.align](),
    top: targetRect.bottom + gap,
  };
  const above = {
    placement: "above",
    left: aligns[config.align](),
    top: targetRect.top - height - gap,
  };
  const left = {
    placement: "left",
    left: targetRect.left - width - gap,
    top: centerY - height / 2,
  };
  const fits = (candidate) =>
    candidate.left >= edge &&
    candidate.top >= edge &&
    candidate.left + width <= viewportWidth - edge &&
    candidate.top + height <= viewportHeight - edge;

  const candidates = [];
  if (config.prefer === "above") candidates.push(above, below, left);
  else if (config.prefer === "left") candidates.push(left, below, above);
  else candidates.push(below, above, left);

  let chosen = candidates.find(fits);
  if (!chosen) {
    const fallback = candidates[0];
    chosen = {
      placement: fallback.placement,
      left: clamp(fallback.left, edge, viewportWidth - width - edge),
      top: clamp(fallback.top, edge, viewportHeight - height - edge),
    };
  }

  callout.style.left = `${chosen.left}px`;
  callout.style.top = `${chosen.top}px`;
  callout.style.right = "auto";
  callout.style.transform = "none";
  callout.dataset.placement = chosen.placement;

  const arrow = callout.querySelector(".guide-callout-arrow");
  if (!arrow) return;
  arrow.style.left = "auto";
  arrow.style.right = "auto";
  arrow.style.top = "auto";
  arrow.style.bottom = "auto";
  arrow.style.marginLeft = "0";
  if (chosen.placement === "below") {
    arrow.style.top = "-9px";
    arrow.style.left = `${clamp(centerX - chosen.left, 20, width - 20)}px`;
    arrow.style.transform = "rotate(225deg)";
  } else if (chosen.placement === "above") {
    arrow.style.bottom = "-9px";
    arrow.style.left = `${clamp(centerX - chosen.left, 20, width - 20)}px`;
    arrow.style.transform = "rotate(45deg)";
  } else if (chosen.placement === "left") {
    arrow.style.right = "-9px";
    arrow.style.top = `${clamp(centerY - chosen.top, 20, height - 20)}px`;
    arrow.style.transform = "rotate(-45deg)";
  } else {
    arrow.style.left = "-9px";
    arrow.style.top = `${clamp(centerY - chosen.top, 20, height - 20)}px`;
    arrow.style.transform = "rotate(135deg)";
  }
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
  const clampedSize = Math.min(24, Math.max(14, numSize));
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

function persistFontSizeToBackend(size) {
  if (!isTauriRuntime()) return;
  invoke("set_ui_font_size", { size: Number(size) }).catch(() => {});
}

async function syncFontSizeFromBackend() {
  if (!isTauriRuntime()) return;
  try {
    const stored = await invoke("get_ui_font_size");
    if (stored === null || stored === undefined) {
      persistFontSizeToBackend(state.settings.fontSize);
      return;
    }
    const size = Math.min(24, Math.max(14, Number(stored) || 16));
    if (state.settings.fontSize === String(size)) return;
    state.settings.fontSize = String(size);
    localStorage.setItem("sherlock-settings", JSON.stringify(state.settings));
    applySettings();
    document
      .querySelectorAll('input[name="font-size-choice"]')
      .forEach((input) => {
        input.checked = input.value === String(size);
      });
    const preview = document.querySelector("#font-size-preview");
    if (preview) preview.style.fontSize = `${size}px`;
    const value = document.querySelector("#font-size-preview-value");
    if (value) value.textContent = `${size} px`;
  } catch {
    // The desktop backend is optional in the web build.
  }
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
  const colorizeGenerated =
    state.generatorType === "password" || state.generatorType === "passphrase";
  if (output && colorizeGenerated && !output.querySelector("span")) {
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
    const strengthPassword = state.generatedValue || generateValue();
    generatedCard.after(
      sanitizedFragment(passwordStrengthMarkup(strengthPassword)),
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

function normalizeGeneratorLength() {
  const required = Math.max(
    GENERATOR_MIN_LENGTH,
    generatorMinimumLength(state.generatorOptions),
  );
  const current = Number(state.generatorOptions.length);
  state.generatorOptions.length = Math.min(
    GENERATOR_MAX_LENGTH,
    Math.max(required, Number.isFinite(current) ? current : 20),
  );
}

function syncGeneratorPasswordControls({ force = false } = {}) {
  const required = Math.max(
    GENERATOR_MIN_LENGTH,
    generatorMinimumLength(state.generatorOptions),
  );
  const values = [
    ["#generator-length", state.generatorOptions.length],
    ["#generator-length-input", state.generatorOptions.length],
    [
      "#generator-min-numbers",
      clampGeneratorMinCount(state.generatorOptions.minNumbers),
    ],
    [
      "#generator-min-symbols",
      clampGeneratorMinCount(state.generatorOptions.minSymbols),
    ],
  ];
  for (const [selector, value] of values) {
    const control = document.querySelector(selector);
    if (!control) continue;
    if (!force && document.activeElement === control) continue;
    control.value = String(value);
  }
  for (const selector of ["#generator-length", "#generator-length-input"]) {
    const control = document.querySelector(selector);
    if (control) control.min = String(required);
  }
}

function updateGeneratedStrengthMeter() {
  const meter = document.querySelector(".password-strength");
  if (!meter) return;
  const strength = passwordStrength(state.generatedValue);
  meter.hidden = false;
  const label = meter.querySelector(".strength-label strong");
  if (label) {
    label.className = `strength-${strength.level}`;
    label.textContent = strength.label;
  }
  const fill = meter.querySelector(".strength-fill");
  if (fill) {
    fill.className = `strength-fill strength-${strength.level} strength-width-${strength.percent}`;
  }
  const hint = meter.querySelector("small");
  if (hint) hint.textContent = strength.hint;
}

function refreshGeneratedDisplay() {
  const output = document.querySelector(".generated-card output");
  if (output) output.textContent = state.generatedValue;
  enhanceRenderedUi();
  updateGeneratedStrengthMeter();
}

function updateGeneratorOptions(event) {
  const target = event.target;
  if (target.dataset.option) {
    state.generatorOptions[target.dataset.option] = target.checked;
    state.generatedValue = generateValue();
    render();
    return;
  }

  if (
    target.id === "generator-length" ||
    target.id === "generator-length-input"
  ) {
    const value = Number(target.value);
    state.generatorOptions.length = Math.min(
      GENERATOR_MAX_LENGTH,
      Math.max(GENERATOR_MIN_LENGTH, Number.isFinite(value) ? value : 20),
    );
    normalizeGeneratorLength();
    state.generatedValue = generateValue();
    syncGeneratorPasswordControls();
    refreshGeneratedDisplay();
    return;
  }

  if (
    target.id === "generator-min-numbers" ||
    target.id === "generator-min-symbols"
  ) {
    const key =
      target.id === "generator-min-numbers" ? "minNumbers" : "minSymbols";
    state.generatorOptions[key] = clampGeneratorMinCount(target.value);
    normalizeGeneratorLength();
    state.generatedValue = generateValue();
    syncGeneratorPasswordControls();
    refreshGeneratedDisplay();
    return;
  }

  if (target.id === "generator-words") {
    state.generatorOptions.words = Math.min(
      12,
      Math.max(5, Number(target.value) || 6),
    );
  }
  if (target.id === "generator-separator") {
    state.generatorOptions.separator = target.value;
  }
  if (target.id === "username-format") {
    state.generatorOptions.usernameFormat = target.value;
  }
  state.generatedValue = generateValue();
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

function setUnlockError(message) {
  state.error = message || "";
  const errorElement = document.querySelector("#unlock-error");
  if (!errorElement) return;
  errorElement.textContent = state.error;
  errorElement.hidden = !state.error;
}

function setPasswordRevealState(button, visible) {
  if (!button) return;
  button.dataset.passwordVisible = String(visible);
  button.setAttribute("aria-pressed", String(visible));
  const label = visible ? "Amagar contrasenya" : "Mostrar contrasenya";
  button.title = label;
  button.setAttribute("aria-label", label);
}

function togglePasswordReveal(inputSelector, button) {
  const input = document.querySelector(inputSelector);
  if (!input) return;
  const visible = input.type === "password";
  input.type = visible ? "text" : "password";
  setPasswordRevealState(button, visible);
}

function renderPasswordFeedback(feedback, password, confirm) {
  if (!feedback) return;
  const meter = feedback.querySelector("[data-password-strength]");
  if (meter) {
    meter.hidden = !password;
    if (password) {
      const strength = passwordStrength(password);
      const label = meter.querySelector(".strength-label strong");
      if (label) {
        label.className = `strength-${strength.level}`;
        label.textContent = strength.label;
      }
      const fill = meter.querySelector(".strength-fill");
      if (fill) {
        fill.className = `strength-fill strength-${strength.level} strength-width-${strength.percent}`;
      }
      const hint = meter.querySelector("small");
      if (hint) hint.textContent = strength.hint;
    }
  }

  const requirements = passwordRequirements(password);
  requirements.forEach((requirement) => {
    const item = feedback.querySelector(
      `[data-requirement="${requirement.id}"]`,
    );
    item?.classList.toggle("is-met", requirement.met);
  });

  const match =
    feedback.querySelector("[data-password-match]") ||
    document.querySelector("[data-password-match]");
  if (!match) return;
  match.hidden = !confirm;
  if (!confirm) return;
  const matches = password === confirm;
  match.dataset.state = matches ? "ok" : "error";
  match.textContent = matches
    ? "Les contrasenyes coincideixen."
    : "Les contrasenyes no coincideixen.";
}

function updatePasswordFeedback(
  feedbackSelector,
  passwordSelector,
  confirmSelector,
) {
  renderPasswordFeedback(
    document.querySelector(feedbackSelector),
    document.querySelector(passwordSelector)?.value || "",
    document.querySelector(confirmSelector)?.value || "",
  );
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
  if (!input) return;
  let masterPassword = input.value;
  const isNewUser = state.vaultExists === false;

  if (!masterPassword) {
    setUnlockError("Introdueix la contrasenya mestra.");
    input.focus();
    return;
  }

  if (isNewUser) {
    if (!passwordMeetsRequirements(masterPassword)) {
      setUnlockError(
        `La contrasenya mestra ha de tenir com a mínim ${MASTER_PASSWORD_MIN_LENGTH} caràcters i incloure majúscules, minúscules, números i un caràcter especial.`,
      );
      updatePasswordFeedback(
        "#master-password-feedback",
        "#master-password",
        "#master-password-confirm",
      );
      input.focus();
      return;
    }
    const confirmation =
      document.querySelector("#master-password-confirm")?.value || "";
    if (masterPassword !== confirmation) {
      setUnlockError("Les contrasenyes no coincideixen.");
      updatePasswordFeedback(
        "#master-password-feedback",
        "#master-password",
        "#master-password-confirm",
      );
      input.focus();
      return;
    }
  }

  setUnlockError("");
  state.loading = true;
  render();
  try {
    const result = isNewUser
      ? await invoke("init_empty_vault", { password: masterPassword })
      : await invoke("unlock_vault", { masterPassword });
    masterPassword = "";
    if (input) input.value = "";
    document.querySelector("#master-password")?.setAttribute("value", "");
    state.entries = (result.entries || []).map(mapVaultEntry);
    state.history = (result.history || []).map((item) => ({
      ...item,
      type: item.kind,
      createdAt: item.created_at,
    }));
    state.trash = (result.trash || []).map((entry) => ({
      ...entry,
      folderId: entry.folder_id || null,
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
      deletedAt: entry.deleted_at,
    }));
    state.entries.forEach((entry) => {
      if (entry.folderId === "default") entry.folderId = "";
    });
    state.folders = (result.folders || []).filter(
      (folder) => folder.id !== "default",
    );
    state.activeFolderId = "";
    state.vaultExists = true;
    state.locked = false;
    resetAutoLock();
    const isNewVault = isNewUser || Boolean(result.isNew ?? result.is_new);
    if (isNewVault) {
      state.firstEntryGuideStep = 1;
      const defaultFolders = [
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
    kind: h.kind || h.type || "Generador",
    value: h.value,
    language: h.language || "Català",
    created_at: h.createdAt || h.created_at || new Date().toISOString(),
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

async function exportVault() {
  const result = await askDialog({
    title: "Exportar la SherLock",
    message:
      "L'exportació conté les contrasenyes en text pla. Desa'l només en un lloc segur.",
    confirmLabel: "Exportar",
    danger: true,
  });
  if (!result.confirmed) return;
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
  const result = await askDialog({
    title: "Importar a la SherLock",
    message:
      "La importació substituirà les dades actuals. Es crearà una còpia xifrada de la caixa abans de desar.",
    confirmLabel: "Importar",
    danger: true,
  });
  if (!result.confirmed) {
    event.target.value = "";
    return;
  }
  const file = event.target.files?.[0];
  if (!file) return;
  try {
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
    if (state.showFirstEntryGuide) state.showFirstEntryGuide = false;
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
  const name = String(form.get("folderName") || "").trim();
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
  const name = String(form.get("site") || "").trim();
  const username = String(form.get("username") || "").trim();
  const password = String(form.get("password") || "");
  const url = String(form.get("url") || "").trim();
  const notes = String(form.get("notes") || "").trim();
  const folderId = String(form.get("folder") || "");

  const draft = { site: name, folderId, username, password, url, notes };

  if (!name || !password) {
    state.entryFormDraft = draft;
    state.formError = !name
      ? "Introdueix el nom de l'element."
      : "Introdueix la contrasenya.";
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
        state.entryFormDraft = draft;
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
    await saveVault();
    const firstGuidedEntry =
      state.showFirstEntryGuide && state.entries.length === 1;
    state.showEntryForm = false;
    state.editingEntryId = null;
    state.showFirstEntryGuide = false;
    state.showTrashHint = firstGuidedEntry;
    state.saving = false;
    render();
    showToast("Accés desat de forma xifrada.");
  } catch (error) {
    state.entries.pop();
    state.entryFormDraft = draft;
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
    site: String(formData.get("site") || ""),
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
  const masterPasswordInput = document.querySelector("#master-password");
  const masterPasswordConfirm = document.querySelector(
    "#master-password-confirm",
  );
  const refreshMasterPasswordFeedback = () => {
    setUnlockError("");
    updatePasswordFeedback(
      "#master-password-feedback",
      "#master-password",
      "#master-password-confirm",
    );
  };
  masterPasswordInput?.addEventListener("input", refreshMasterPasswordFeedback);
  masterPasswordConfirm?.addEventListener(
    "input",
    refreshMasterPasswordFeedback,
  );

  document
    .querySelector("#change-auth-method")
    ?.addEventListener("click", () => {
      state.showChangeAuthModal = true;
      state.changeAuthError = "";
      render();
    });

  const changePasswordInput = document.querySelector(
    "#change-auth-new-password",
  );
  const changePasswordConfirm = document.querySelector(
    "#change-auth-confirm-password",
  );
  const refreshChangePasswordFeedback = () => {
    state.changeAuthError = "";
    const errorElement = document.querySelector("#change-auth-error");
    if (errorElement) errorElement.hidden = true;
    updatePasswordFeedback(
      "#change-auth-password-feedback",
      "#change-auth-new-password",
      "#change-auth-confirm-password",
    );
  };
  changePasswordInput?.addEventListener("input", refreshChangePasswordFeedback);
  changePasswordConfirm?.addEventListener(
    "input",
    refreshChangePasswordFeedback,
  );

  document
    .querySelector("#save-auth-method")
    ?.addEventListener("click", async () => {
      const newPassword = changePasswordInput?.value || "";
      const confirmPassword = changePasswordConfirm?.value || "";
      const errorElement = document.querySelector("#change-auth-error");
      const showError = (message) => {
        state.changeAuthError = message;
        if (!errorElement) return;
        errorElement.textContent = message;
        errorElement.hidden = false;
      };

      if (!passwordMeetsRequirements(newPassword)) {
        showError(
          `La contrasenya mestra ha de tenir com a mínim ${MASTER_PASSWORD_MIN_LENGTH} caràcters i incloure majúscules, minúscules, números i un caràcter especial.`,
        );
        refreshChangePasswordFeedback();
        return;
      }
      if (newPassword !== confirmPassword) {
        showError("Les contrasenyes no coincideixen.");
        refreshChangePasswordFeedback();
        return;
      }

      state.changeAuthBusy = true;
      const saveButton = document.querySelector("#save-auth-method");
      if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = "Canviant...";
      }
      try {
        await invoke("change_master_password", { newPassword });
        state.showChangeAuthModal = false;
        state.changeAuthError = "";
        showToast("Contrasenya mestra canviada.");
        render();
      } catch (error) {
        showError(String(error));
      } finally {
        state.changeAuthBusy = false;
        if (saveButton?.isConnected) {
          saveButton.disabled = false;
          saveButton.textContent = "Canvia la contrasenya";
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
  document
    .querySelector("#reveal-password")
    ?.addEventListener("click", (event) => {
      togglePasswordReveal("#master-password", event.currentTarget);
    });
  document
    .querySelector("#reveal-password-confirm")
    ?.addEventListener("click", (event) => {
      togglePasswordReveal("#master-password-confirm", event.currentTarget);
    });
  document.querySelectorAll("#open-cloud-login").forEach((button) =>
    button.addEventListener("click", () => {
      state.cloudError = "";
      resetCloudUsernameCheck();
      state.cloudActionContext =
        button.dataset.context || (state.locked ? "download" : "settings");
      state.showCloudLogin = true;
      resetCloudPasswordMatchCheck();
      render();
    }),
  );
  document.querySelectorAll("#cancel-cloud-login").forEach((button) =>
    button.addEventListener("click", () => {
      state.showCloudLogin = false;
      state.showPrivacyPolicy = false;
      state.cloudError = "";
      resetCloudUsernameCheck();
      render();
    }),
  );
  document.querySelectorAll("#open-privacy-policy").forEach((button) =>
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.showPrivacyPolicy = true;
      render();
    }),
  );
  document
    .querySelectorAll("#close-privacy-policy, #close-privacy-policy-bottom")
    .forEach((button) =>
      button.addEventListener("click", () => {
        state.showPrivacyPolicy = false;
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
    resetCloudUsernameCheck();
    resetCloudPasswordMatchCheck();
    render();
  });
  document
    .querySelector("#tab-cloud-register")
    ?.addEventListener("click", () => {
      state.cloudTab = "register";
      state.cloudError = "";
      resetCloudUsernameCheck();
      resetCloudPasswordMatchCheck();
      render();
    });
  document
    .querySelector("#toggle-cloud-advanced")
    ?.addEventListener("click", () => {
      state.cloudShowAdvanced = !state.cloudShowAdvanced;
      render();
      if (state.cloudShowAdvanced) void checkUsernameAvailability();
    });
  document
    .querySelector("#cloud-railway-url")
    ?.addEventListener("input", () => {
      resetCloudUsernameCheck();
      setCloudError("");
    });
  document.querySelector("#cloud-railway-url")?.addEventListener("blur", () => {
    void checkUsernameAvailability();
  });
  document
    .querySelector("#reveal-cloud-password")
    ?.addEventListener("click", (event) => {
      togglePasswordReveal("#auth-password", event.currentTarget);
    });
  document
    .querySelector("#auth-password")
    ?.addEventListener("input", updateCloudPasswordFeedback);
  document
    .querySelector("#auth-confirm-password")
    ?.addEventListener("input", updateCloudPasswordFeedback);
  if (document.querySelector("#cloud-password-feedback")) {
    updateCloudPasswordFeedback();
  }

  document
    .querySelector("#auth-username")
    ?.addEventListener("input", (event) => {
      const value = event.currentTarget.value;
      state.cloudFormUsername = value;
      resetCloudUsernameCheck();
      setCloudError("");
      if (state.cloudTab === "register" && value.trim().length >= 3) {
        scheduleCloudUsernameCheck();
      }
    });
  document.querySelector("#auth-username")?.addEventListener("blur", () => {
    if (cloudUsernameCheckTimer) {
      clearTimeout(cloudUsernameCheckTimer);
      cloudUsernameCheckTimer = null;
    }
    void checkUsernameAvailability();
  });

  document
    .querySelector("#btn-cloud-sync-now")
    ?.addEventListener("click", handleCloudSyncNow);
  document
    .querySelector("#btn-cloud-logout")
    ?.addEventListener("click", handleCloudLogout);

  document
    .querySelector("#btn-cloud-delete-account")
    ?.addEventListener("click", handleDeleteCloudAccount);
  document
    .querySelectorAll('[data-cloud-action="sync"]')
    .forEach((button) => button.addEventListener("click", handleCloudSyncNow));
  document
    .querySelectorAll('[data-cloud-action="logout"]')
    .forEach((button) => button.addEventListener("click", handleCloudLogout));
  document
    .querySelectorAll('[data-cloud-action="delete-account"]')
    .forEach((button) =>
      button.addEventListener("click", handleDeleteCloudAccount),
    );
  document.querySelectorAll(".cloud-more").forEach((details) =>
    details.addEventListener("toggle", () => {
      state.cloudMoreOpen = details.open;
    }),
  );
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
      if (state.showFirstEntryGuide && state.firstEntryGuideStep === 4) {
        state.firstEntryGuideStep = 3;
      }
    }
    if (state.showFirstEntryGuide && !state.showEntryForm) {
      state.showFirstEntryGuide = false;
    }
    state.view = "vault";
    stopBrowserPairingTimers();
    state.browserPairingCode = "";
    render();
  });
  document.querySelector("#nav-settings")?.addEventListener("click", () => {
    state.showFirstEntryGuide = false;
    state.view = "settings";
    render();
    // Refresh browser list in background — don't block or re-render here.
    refreshPairedBrowsers().catch(() => {});
  });
  document.querySelector("#nav-generator")?.addEventListener("click", () => {
    state.showFirstEntryGuide = false;
    state.generatorType = "password";
    state.generatedValue = generateValue();
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
    fontSlider.addEventListener("change", (event) => {
      persistFontSizeToBackend(event.target.value);
    });
  }

  document
    .querySelectorAll('input[name="font-size-choice"]')
    .forEach((input) => {
      input.addEventListener("change", (event) => {
        if (!event.target.checked) return;
        state.settings.fontSize = String(event.target.value);
        persistSettings();
        persistFontSizeToBackend(event.target.value);
        const preview = document.querySelector("#font-size-preview");
        if (preview) preview.style.fontSize = `${event.target.value}px`;
        const value = document.querySelector("#font-size-preview-value");
        if (value) value.textContent = `${event.target.value} px`;
      });
    });

  document.querySelectorAll("[data-setup-theme]").forEach((button) => {
    button.addEventListener("click", () => {
      state.settings.theme = button.dataset.setupTheme;
      persistSettings();
      document.querySelectorAll("[data-setup-theme]").forEach((item) => {
        const active = item.dataset.setupTheme === state.settings.theme;
        item.classList.toggle("selected", active);
        item.setAttribute("aria-pressed", String(active));
      });
    });
  });

  if (state.showSetupPreferences) {
    requestAnimationFrame(() => {
      document.querySelector(".setup-theme-choice.selected")?.focus();
    });
  }

  const finishSetupPreferences = () => {
    persistSettings();
    state.showSetupPreferences = false;
    render();
    requestAnimationFrame(() =>
      document.querySelector("#master-password")?.focus(),
    );
  };
  document
    .querySelector("#confirm-setup-preferences")
    ?.addEventListener("click", finishSetupPreferences);
  document
    .querySelector("#skip-setup-preferences")
    ?.addEventListener("click", finishSetupPreferences);

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
  document.querySelector("#trash-hint-open")?.addEventListener("click", () => {
    state.showTrashHint = false;
    state.showTrashModal = true;
    render();
  });
  document
    .querySelector("#trash-hint-dismiss")
    ?.addEventListener("click", () => {
      state.showTrashHint = false;
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
    .querySelectorAll(
      "#generator-length, #generator-length-input, #generator-min-numbers, #generator-min-symbols",
    )
    .forEach((input) => {
      input.addEventListener("input", updateGeneratorOptions);
      input.addEventListener("change", () => {
        normalizeGeneratorLength();
        syncGeneratorPasswordControls({ force: true });
      });
    });
  document
    .querySelector("#generator-words")
    ?.addEventListener("change", updateGeneratorOptions);
  document
    .querySelector("#username-format")
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
        if (state.showFirstEntryGuide) {
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
    ?.addEventListener("click", (event) => {
      togglePasswordReveal("#details-password", event.currentTarget);
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
      togglePasswordReveal("#entry-password", event.currentTarget);
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

  document
    .querySelectorAll("#app-dialog-cancel, #app-dialog-cancel-bottom")
    .forEach((button) =>
      button.addEventListener("click", () => closeAppDialog(false)),
    );
  document
    .querySelector("#app-dialog-confirm")
    ?.addEventListener("click", () => closeAppDialog(true));
  document
    .querySelector("#app-dialog-third")
    ?.addEventListener("click", () => closeAppDialog("third"));
  document
    .querySelector("#app-dialog-backdrop")
    ?.addEventListener("click", (event) => {
      if (event.target.id === "app-dialog-backdrop") closeAppDialog(false);
    });
  document
    .querySelector("#app-dialog-require-text")
    ?.addEventListener("input", (event) => {
      if (state.appDialog)
        state.appDialog.requireTextValue = event.target.value;
      updateAppDialogConfirmButton();
    });
  document
    .querySelector("#app-dialog-password")
    ?.addEventListener("input", (event) => {
      if (state.appDialog) state.appDialog.passwordValue = event.target.value;
      updateAppDialogConfirmButton();
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
} catch {
  // Older webviews may not expose matchMedia change events.
}

["pointerdown", "keydown", "touchstart"].forEach((eventName) =>
  window.addEventListener(eventName, resetAutoLock, { passive: true }),
);

window.addEventListener("keydown", (event) => {
  if (state.showPrivacyPolicy) {
    if (event.key === "Escape") {
      event.preventDefault();
      state.showPrivacyPolicy = false;
      render();
    }
    return;
  }

  const isPaletteShortcut =
    (event.metaKey || event.ctrlKey) && event.shiftKey && event.code === "KeyP";
  if (isPaletteShortcut && !isTauriRuntime()) {
    event.preventDefault();
    state.showCommandPalette ? closeCommandPalette() : openCommandPalette();
    return;
  }
  if (state.appDialog) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAppDialog(false);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const btn = document.querySelector("#app-dialog-confirm");
      if (btn && !btn.disabled) closeAppDialog(true);
      return;
    }
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
  } catch (error) {
    showToast(`No s'ha pogut recarregar la caixa forta: ${error}`);
  }
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
  syncFontSizeFromBackend();
  if (!state.locked) {
    reloadVaultEntries();
  }
});

window.addEventListener("resize", scheduleGuidePosition);
document.addEventListener("scroll", scheduleGuidePosition, true);
if (document.fonts?.ready) {
  document.fonts.ready.then(scheduleGuidePosition).catch(() => {});
}

initializeApp();
syncFontSizeFromBackend();

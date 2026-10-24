import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  createIcons,
  Search,
  Plus,
  ShieldCheck,
  Settings,
  ExternalLink,
  Copy,
  MoreHorizontal,
  Folder,
  Briefcase,
  House,
  CreditCard,
  ShoppingBag,
  Gamepad2,
  Landmark,
  GraduationCap,
  Users,
  Heart,
  Plane,
  Smartphone,
  Camera,
  Music,
  KeyRound,
  Sparkles,
  Globe,
  LockKeyhole,
  Eye,
  EyeOff,
  X,
  RefreshCw,
  Star,
  Languages,
  Trash2,
  Vault,
  Check,
  Timer,
  Upload,
  Download,
  ArrowRight,
  Palette,
  Type,
  Moon,
  Sun,
  Monitor,
  RotateCcw,
  Pencil,
  Cloud,
} from "lucide";
import "./styles.css";
import "./secure.css";

const icons = {
  Search,
  Plus,
  ShieldCheck,
  Settings,
  ExternalLink,
  Copy,
  MoreHorizontal,
  Folder,
  Briefcase,
  House,
  CreditCard,
  ShoppingBag,
  Gamepad2,
  Landmark,
  GraduationCap,
  Users,
  Heart,
  Plane,
  Smartphone,
  Camera,
  Music,
  KeyRound,
  Sparkles,
  Globe,
  LockKeyhole,
  Eye,
  EyeOff,
  X,
  RefreshCw,
  Star,
  Languages,
  Trash2,
  Vault,
  Check,
  Timer,
  Upload,
  Download,
  ArrowRight,
  Palette,
  Type,
  Moon,
  Sun,
  Monitor,
  RotateCcw,
  Pencil,
  Cloud,
};

const defaultSettings = {
  theme: "auto",
  fontSize: "16",
  accent: "blue",
  autoLock: "15",
};

const folderIcons = [
  "Folder",
  "Star",
  "Globe",
  "Briefcase",
  "ShieldCheck",
  "House",
  "CreditCard",
  "ShoppingBag",
  "Gamepad2",
  "Landmark",
  "GraduationCap",
  "Users",
  "Heart",
  "Plane",
  "Smartphone",
  "Camera",
  "Music",
  "KeyRound",
];
const folderColors = [
  "#2471d1",
  "#2563eb",
  "#7c3aed",
  "#9c6ade",
  "#c026d3",
  "#db2777",
  "#dc2626",
  "#ea580c",
  "#d97706",
  "#ca8a04",
  "#65a30d",
  "#059669",
  "#0f766e",
  "#0891b2",
  "#475569",
];

let autoLockTimer;
let clipboardClearTimer;
let paletteHideTimer;

const savedSettings = (() => {
  try {
    const parsed = JSON.parse(
      localStorage.getItem("caixa-forta-settings") || "{}",
    );
    return { ...defaultSettings, ...parsed };
  } catch {
    return { ...defaultSettings };
  }
})();

const savedCloudConfig = (() => {
  try {
    return JSON.parse(localStorage.getItem("caixa-forta-cloud") || "{}");
  } catch {
    return {};
  }
})();

const state = {
  locked: true,
  vaultExists: null,
  showWelcome: false,
  welcomeStep: 0,
  showFirstEntryGuide: false,
  firstEntryGuideStep: 1,
  masterPassword: "",
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
  cloudConfig: { railwayUrl: "", vaultId: "", token: "", ...savedCloudConfig },
  showCloudLogin: false,
  cloudLoading: false,
  cloudError: "",
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
  gridSeed: null,
  gridPattern: [],
  gridCellSize: 4,
  showGridSetup: false,
  gridSetupStep: 0,
  gridSetupPattern: [],
  gridSetupError: "",
  imageAuthImage: "",
  imageGridCellValues: [],
  imageGridPattern: [],
  imageGridBrushPath: [],
  imageUnlockBrushPath: [],
  legacyImageAuthPattern: [],
  changingAuthMethod: false,
  showGridUnlock: false,
  gridUnlockPattern: [],
  gridUnlockError: "",
  showChangeAuthModal: false,
  changeAuthSelected: "password",
  changeAuthBusy: false,
  changeAuthError: "",
};

let imageAuthRenderSource = "";
let imageAuthRenderBitmap = null;
/* ==========================================================================
   Funcions d'utilitat
   ========================================================================== */

const isTauriRuntime = () => Boolean(window.__TAURI_INTERNALS__);

const icon = (name, size = 18) => {
  const kebabName = name
    .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    .replace(/^-/, "");
  return `<i data-lucide="${kebabName}" width="${size}" height="${size}"></i>`;
};

const escapeHtml = (value = "") =>
  String(value).replace(
    /[&<>'"]/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[char],
  );

function formatDate(isoString) {
  if (!isoString) return "";
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString("ca-ES", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

function parseEntryNotes(notes = "") {
  let url = "";
  let cleanNotes = notes;
  if (notes.startsWith("URL: ")) {
    const lines = notes.split("\n");
    url = lines[0].replace(/^URL:\s*/, "").trim();
    cleanNotes = lines.slice(1).join("\n").trim();
  }
  return { url, cleanNotes };
}

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
  try {
    await invoke("lock_vault");
  } catch (error) {
    showToast(`No s'ha pogut bloquejar la caixa forta: ${error}`);
    resetAutoLock();
    return;
  }

  state.locked = true;
  state.masterPassword = "";
  state.entries = [];
  state.folders = [];
  state.history = [];
  state.trash = [];
  state.query = "";
  state.showChangeAuthModal = false;
  state.showGridSetup = false;
  state.gridUnlockError = "";
  state.gridUnlockPattern = [];
  state.imageGridPattern = [];
  state.imageUnlockBrushPath = [];
  state.imageGridCellValues = [];
  state.legacyImageAuthPattern = [];
  state.imageAuthImage = "";
  state.showGridUnlock = false;

  try {
    const authData = await invoke("get_image_grid_auth");
    if (authData?.type === "image_grid") {
      state.imageAuthImage = authData.image_data || "";
      state.imageGridCellValues = authData.cell_values || [];
      state.showGridUnlock = true;
    } else if (authData?.pattern) {
      state.legacyImageAuthPattern = authData.pattern;
      state.imageAuthImage = localStorage.getItem("image_auth_image") || "";
      state.showGridUnlock = true;
    }
  } catch {
    state.showGridUnlock = false;
  }
  state.view = "vault";
  render();
}

// Lock screen check

async function checkVaultLocked() {
  try {
    const info = await invoke("get_vault_info");
    if (info.exists) {
      try {
        await invoke("unlock_vault", { masterPassword: "" });
      } catch (error) {
        return true;
      }
    }
  } catch (error) {}
  return false;
}

function cloudFormConfig() {
  return {
    provider: document.querySelector("#cloud-provider")?.value || "official",
    railwayUrl: document.querySelector("#railway-url")?.value.trim() || "",
    vaultId: document.querySelector("#railway-vault-id")?.value.trim() || "",
    token: document.querySelector("#railway-token")?.value.trim() || "",
    username: document.querySelector("#auth-username")?.value.trim() || "",
    password: document.querySelector("#auth-password")?.value || "",
    confirmPassword:
      document.querySelector("#auth-confirm-password")?.value || "",
    privacyAccepted:
      document.querySelector("#privacy-accepted")?.checked || false,
  };
}

async function initializeApp() {
  render();
  if (!isTauriRuntime()) return;
  try {
    const info = await invoke("get_vault_info");
    state.vaultExists = Boolean(info.exists);

    if (!state.vaultExists) {
      state.showWelcome = false;
      state.showAuthMethodSelection = true;
    } else {
      const hasGridAuth = await checkGridAuth();
      if (hasGridAuth) {
        state.gridUnlockPattern = [];
        state.imageGridPattern = [];
        const imageGrid = await invoke("get_image_grid_auth");
        if (imageGrid?.type === "image_grid") {
          state.imageAuthImage = imageGrid.image_data;
          state.imageGridCellValues = imageGrid.cell_values || [];
          state.legacyImageAuthPattern = [];
        } else {
          state.imageGridCellValues = [];
          state.legacyImageAuthPattern = imageGrid?.pattern || [];
          state.imageAuthImage = localStorage.getItem("image_auth_image") || "";
        }
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
    provider: config.provider,
    railway_url: config.railwayUrl,
    vault_id: config.vaultId,
    token: config.token,
  };
}

async function saveCloudConfig(event) {
  event.preventDefault();
  const config = cloudFormConfig();
  state.cloudLoading = true;
  state.cloudError = "";
  render();
  try {
    await invoke("set_railway_sync_config", rustCloudConfig(config));
    state.cloudConfig = config;
    localStorage.setItem("caixa-forta-cloud", JSON.stringify(config));
    state.showCloudLogin = false;
    showToast("Connexió amb Railway desada.");
  } catch (error) {
    state.cloudError = String(error);
  } finally {
    state.cloudLoading = false;
    render();
  }
}

async function downloadCloudVault() {
  const config = cloudFormConfig();

  if (config.provider === "official" && !state.cloudConfig.authUser) {
    if (!state.locked) {
      showToast("L'usuari no està autenticat. Autentica primer.");
      return;
    }
    if (!confirm("La contrasenya mestra per obrir la caixa forta:")) return;
  }

  state.cloudLoading = true;
  state.cloudError = "";
  render();
  try {
    const serialized = await invoke("sync_download_vault", {
      masterPassword: config.password,
      config: rustCloudConfig(config),
    });
    const vault = JSON.parse(serialized);
    state.cloudConfig = config;
    localStorage.setItem("caixa-forta-cloud", JSON.stringify(config));
    state.entries = (vault.entries || []).map((entry) => ({
      ...entry,
      folderId: entry.folder_id || null,
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
    }));
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
    state.locked = false;
    state.showCloudLogin = false;
    showToast("Vault descarregat del núvol.");
  } catch (error) {
    state.cloudError = String(error);
  } finally {
    state.cloudLoading = false;
    render();
  }
}

async function registerCloudVault() {
  const config = cloudFormConfig();
  if (config.password !== config.confirmPassword) {
    state.cloudError = "Les contrasenyes no coincideixen.";
    render();
    return;
  }
  if (config.password.length < 16) {
    state.cloudError =
      "La contrasenya mestra ha de tenir almenys 16 caràcters.";
    render();
    return;
  }
  if (!config.privacyAccepted) {
    state.cloudError = "Has d'acceptar la Política de Privacitat.";
    render();
    return;
  }

  const masterPassword = config.password;
  state.cloudLoading = true;
  state.cloudError = "";
  render();
  try {
    if (config.provider === "official") {
      await invoke("auth_official_cloud", {
        username: config.username,
        password: masterPassword,
      });
      state.cloudConfig.authUser = config.username;
    } else {
      await invoke("register_vault", {
        masterPassword,
        config: rustCloudConfig(config),
      });
    }
    state.cloudConfig = config;
    localStorage.setItem("caixa-forta-cloud", JSON.stringify(config));
    state.showCloudLogin = false;
    showToast(
      config.provider === "official"
        ? "Authenticació completada. Obre la caixa forta."
        : "Vault creat al núvol.",
    );
  } catch (error) {
    state.cloudError = String(error);
  } finally {
    state.cloudLoading = false;
    render();
  }
}

async function cloudAuthSubmit(event) {
  event.preventDefault();
  const config = cloudFormConfig();

  if (config.password !== config.confirmPassword) {
    state.cloudError = "Les contrasenyes no coincideixen.";
    render();
    return;
  }
  if (config.password.length < 16) {
    state.cloudError =
      "La contrasenya mestra ha de tenir almenys 16 caràcters.";
    render();
    return;
  }
  if (!config.privacyAccepted) {
    state.cloudError = "Has d'acceptar la Política de Privacitat.";
    render();
    return;
  }

  state.cloudLoading = true;
  state.cloudError = "";
  render();

  try {
    if (config.provider === "official") {
      await invoke("auth_official_cloud", {
        username: config.username,
        password: config.password,
      });
      state.cloudConfig.authUser = config.username;
      state.locked = false;
    } else {
      await invoke("set_railway_sync_config", rustCloudConfig(config));
      state.cloudConfig = config;
      localStorage.setItem("caixa-forta-cloud", JSON.stringify(config));
    }

    state.showCloudLogin = false;
    showToast(
      config.provider === "official"
        ? "Autenticació completada. Obre la caixa forta."
        : "Connexió amb Railway completada.",
    );
  } catch (error) {
    state.cloudError = String(error);
  } finally {
    state.cloudLoading = false;
    render();
  }
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
  try {
    await invoke("reset_vault");
    localStorage.removeItem("caixa-forta-master-password");
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
    showToast("Dades locals eliminades.");
  } catch (error) {
    showToast(`No s'han pogut eliminar les dades: ${error}`);
  }
  state.masterPassword = "";
  render();
}

function render() {
  const appContainer = document.querySelector("#app");
  if (!appContainer) return;
  document.documentElement.dataset.locked = String(state.locked);

  if (state.locked) {
    appContainer.innerHTML = lockScreen();
  } else if (state.view === "generator") {
    appContainer.innerHTML = generatorScreen();
  } else if (state.view === "settings") {
    appContainer.innerHTML = settingsScreen();
  } else {
    appContainer.innerHTML = vaultScreen();
  }

  if (!state.locked && state.showCommandPalette) {
    appContainer.insertAdjacentHTML("beforeend", commandPalette());
  }
  if (!state.locked && state.toast) {
    appContainer.insertAdjacentHTML(
      "beforeend",
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
  state.settings.fontSize = String(numSize);

  document.documentElement.dataset.theme = state.settings.theme || "auto";
  document.documentElement.dataset.accent = state.settings.accent || "blue";
  document.documentElement.style.setProperty("--app-font-size", `${numSize}px`);
  document.documentElement.style.fontSize = `${numSize}px`;

  const themeSelect = document.querySelector("#theme-setting");
  const fontSizeInput = document.querySelector("#font-size-setting");
  const fontSizeOut = document.querySelector("#font-size-value");
  const autoLockSelect = document.querySelector("#auto-lock");

  if (themeSelect) themeSelect.value = state.settings.theme || "auto";
  if (fontSizeInput) fontSizeInput.value = String(numSize);
  if (fontSizeOut) fontSizeOut.textContent = `${numSize} px`;
  if (autoLockSelect) autoLockSelect.value = state.settings.autoLock || "15";

  document.querySelectorAll("[data-accent]").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.accent === (state.settings.accent || "blue"),
    );
  });
}

function persistSettings() {
  localStorage.setItem("caixa-forta-settings", JSON.stringify(state.settings));
  applySettings();
}

function enhanceRenderedUi() {
  document.querySelector(".sidebar-note")?.remove();

  const emptyIcon = document.querySelector(".empty > svg");
  if (emptyIcon) {
    emptyIcon.outerHTML = icon("Vault", 28);
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
    output.innerHTML = Array.from(output.textContent || "", (character) => {
      const className = /[0-9]/.test(character)
        ? "generated-number"
        : /[^A-Za-z0-9]/.test(character)
          ? "generated-symbol"
          : "";
      return `<span class="${className}">${escapeHtml(character)}</span>`;
    }).join("");
  }

  const generatedCard = document.querySelector(".generated-card");
  if (
    generatedCard &&
    state.generatorType === "password" &&
    !document.querySelector(".password-strength")
  ) {
    const strength = passwordStrength(state.generatedValue || generateValue());
    generatedCard.insertAdjacentHTML(
      "afterend",
      `
      <div class="password-strength">
        <div class="strength-label">
          <span>Força de la contrasenya</span>
          <strong class="strength-${strength.level}">${strength.label}</strong>
        </div>
        <div class="strength-track">
          <span class="strength-fill strength-${strength.level}" style="width:${strength.percent}%"></span>
        </div>
        <small>${strength.hint}</small>
      </div>
      `,
    );
  }
}

function bottomNavComponent(activeTab = "vault") {
  return `
    <footer class="bottom-nav">
      <button class="nav ${activeTab === "vault" ? "active" : ""}" id="nav-vault">
        ${icon("ShieldCheck", 21)}
        <span>Caixa forta</span>
      </button>
      <button class="nav" id="nav-new">
        ${icon("Plus", 21)}
        <span>Crear</span>
      </button>
      <button class="nav ${activeTab === "generator" ? "active" : ""}" id="nav-generator">
        ${icon("RefreshCw", 21)}
        <span>Generador</span>
      </button>
      <button class="nav ${activeTab === "settings" ? "active" : ""}" id="nav-settings">
        ${icon("Settings", 21)}
        <span>Configuració</span>
      </button>
    </footer>
  `;
}

function sidebarComponent() {
  return `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">${icon("ShieldCheck", 21)}</div>
        <span>Caixa forta</span>
      </div>
      <div class="folders-heading">
        <p class="side-label">LA TEVA ORGANITZACIÓ</p>
        <div>
          <button class="folder-control" id="new-folder" title="Afegir carpeta">${icon("Plus", 16)}</button>
          <button class="folder-control" id="edit-folder" title="Editar la carpeta seleccionada" ${state.activeFolderId ? "" : "disabled"}>${icon("Pencil", 15)}</button>
        </div>
      </div>
      <nav class="folders">
        <button class="folder ${!state.activeFolderId ? "active" : ""}" data-folder="">
          <span class="folder-icon blue">${icon("ShieldCheck", 17)}</span>
          <span>Tots els elements</span>
          <b class="count">${state.entries.length}</b>
        </button>
        ${state.folders.map(folderItem).join("")}
      </nav>
    </aside>
  `;
}

function folderItem(folder) {
  const count = state.entries.filter(
    (entry) => entry.folderId === folder.id,
  ).length;
  return `
    <button class="folder ${state.activeFolderId === folder.id ? "active" : ""}" data-folder="${escapeHtml(folder.id)}">
      <span class="folder-icon" style="color:${escapeHtml(folder.color)};background:${escapeHtml(folder.color)}1f">${icon(folder.icon, 17)}</span>
      <span>${escapeHtml(folder.name)}</span>
      <b class="count">${count}</b>
    </button>
  `;
}

function entryCard(entry) {
  return `
    <article class="entry" data-view-entry="${entry.id}">
      <div class="site-badge">${icon("Globe", 22)}</div>
      <div class="entry-info">
        <strong>${escapeHtml(entry.site)}</strong>
        <span>${escapeHtml(entry.username)}</span>
      </div>
      <div class="entry-actions">
        <button class="icon-btn" title="Obrir lloc web" data-open="${escapeHtml(entry.site)}">
          ${icon("ExternalLink")}
        </button>
        <button class="icon-btn copy-action" title="Copiar la contrasenya" data-copy="${entry.id}">
          ${icon("Copy")}
        </button>
        <button class="icon-btn more" title="Detalls, editar o eliminar" data-view-action="${entry.id}">
          ${icon("MoreHorizontal")}
        </button>
      </div>
    </article>
  `;
}

function commandPalette() {
  const query = state.paletteQuery.trim().toLowerCase();
  const results = state.entries
    .filter((entry) =>
      `${entry.site} ${entry.username}`.toLowerCase().includes(query),
    )
    .slice(0, 8);

  return `
    <div class="palette-backdrop" id="palette-backdrop">
      <section class="command-palette" role="dialog" aria-modal="true" aria-label="Cerca accessos">
        <label class="palette-search">
          ${icon("Search", 20)}
          <input id="palette-search" type="search" value="${escapeHtml(state.paletteQuery)}" placeholder="Cerca un servei o usuari…" autocomplete="off" />
          <kbd>ESC</kbd>
        </label>
        <div class="palette-results" id="palette-results" role="listbox" aria-label="Accessos">
          ${
            results.length
              ? results
                  .map(
                    (entry, index) => `
            <button class="palette-result ${index === state.paletteIndex ? "selected" : ""}" data-palette-entry="${escapeHtml(entry.id)}" role="option" aria-selected="${index === state.paletteIndex}">
                          <button class="palette-result ${index === state.paletteIndex ? "selected" : ""} ${state.paletteCopiedId === entry.id ? "is-copied" : ""}" data-palette-entry="${escapeHtml(entry.id)}" role="option" aria-selected="${index === state.paletteIndex}">
              <span class="palette-result-mark">${icon("Globe", 18)}</span>
                            <span class="palette-result-mark">${icon(state.paletteCopiedId === entry.id ? "Check" : "Globe", 18)}</span>
              <span class="palette-result-copy"><strong>${escapeHtml(entry.site)}</strong><small>${escapeHtml(entry.username)}</small></span>
              <span class="palette-result-action">${icon("Copy", 15)} <kbd>Enter</kbd></span>
            </button>
          `,
                  )
                  .join("")
              : `<p class="palette-empty">${query ? "Cap accés coincideix amb la cerca." : "La caixa forta no conté accessos."}</p>`
          }
        </div>
        <footer class="palette-footer"><span>${results.length} ${results.length === 1 ? "accés" : "accessos"}</span><span><kbd>↑</kbd><kbd>↓</kbd> navegar</span><span><kbd>Enter</kbd> copiar</span></footer>
      </section>
    </div>
  `;
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

function lockScreen() {
  return `
    <main class="lock-shell">
      <div class="lock-card">
        <div class="brand-mark large">${icon("ShieldCheck", 28)}</div>
        <p class="eyebrow">CAIXA FORTA LOCAL</p>
        <h1>Un espai segur per als teus accessos</h1>
        <p class="lock-copy">
          Si és el primer ús, crea ara una contrasenya mestra nova. La necessitaràs cada vegada que obris la caixa forta.
        </p>
        <form id="unlock-form">
          <label class="field-label" for="master-password">Contrasenya mestra</label>
          <div class="password-field">
            ${icon("LockKeyhole", 17)}
            <input
              id="master-password"
              type="password"
              minlength="12"
              autocomplete="current-password"
              placeholder="12 caràcters o més"
              required
            />
            <button type="button" class="reveal" id="reveal-password" title="Mostrar contrasenya">
              ${icon("Eye", 17)}
            </button>
          </div>
          ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ""}
          <button class="primary full" type="submit" ${state.loading ? "disabled" : ""}>
            ${state.loading ? "Desbloquejant..." : "Crear o desbloquejar la caixa forta"}
          </button>
        </form>
        <button class="secondary full" id="open-cloud-login">
          ${icon("Cloud", 17)} Descarregar des del núvol
        </button>
        <p class="security-note">
          ${icon("ShieldCheck", 15)} Xifratge local amb Argon2id i AES-256-GCM
        </p>
      </div>
    </main>
    ${state.showWelcome ? welcomeModal() : ""}
    ${state.showAuthMethodSelection ? authMethodSelectionModal() : ""}
    ${state.showGridSetup ? imageAuthSetupModal() : ""}
    ${state.showGridUnlock ? imageAuthUnlockModal() : ""}
    ${state.showChangeAuthModal ? changeAuthMethodModal() : ""}
    ${state.showCloudLogin ? cloudLoginModal() : ""}
  `;
}

function welcomeModal() {
  const slides = [
    {
      icon: "ShieldCheck",
      kicker: "PROTECCIÓ LOCAL",
      title: "Tot el que necessites, en un sol lloc",
      text: "La Caixa Forta guarda els teus accessos de manera local i protegida, perquè els tinguis sempre a mà.",
    },
    {
      icon: "KeyRound",
      kicker: "UNA SOLA CLAU",
      title: "Recorda només la contrasenya mestra",
      text: "És l'única clau que necessitaràs. No la podem recuperar, així que tria'n una de llarga i guarda-la bé.",
    },
    {
      icon: "Plus",
      kicker: "A punt per començar",
      title: "Afegeix els teus primers accessos",
      text: "Després podràs guardar llocs web, usuaris, contrasenyes i notes privades dins la teva caixa forta.",
    },
  ];
  const slide = slides[state.welcomeStep] || slides[0];
  const isLastSlide = state.welcomeStep === slides.length - 1;

  return `
    <div class="modal-backdrop">
      <section class="entry-modal welcome-slideshow" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <header class="modal-header">
          <div class="brand-mark">${icon(slide.icon, 22)}</div>
          <div>
            <p class="welcome-slide-count">PAS ${state.welcomeStep + 1} DE ${slides.length}</p>
            <h2 id="welcome-title">Benvingut a la Caixa Forta</h2>
          </div>
        </header>
        <div class="welcome-slide" aria-live="polite">
          <p class="welcome-slide-kicker">${slide.kicker}</p>
          <h3>${slide.title}</h3>
          <p>${slide.text}</p>
        </div>
        <footer class="modal-footer">
          <div class="welcome-dots" aria-label="Progrés de la introducció">
            ${slides.map((_, index) => `<span class="welcome-dot ${index === state.welcomeStep ? "active" : ""}"></span>`).join("")}
          </div>
          <button type="button" class="primary" id="next-welcome">
            ${isLastSlide ? "Crear contrasenya mestra" : "Continuar"} ${icon("ArrowRight", 17)}
          </button>
        </footer>
      </section>
    </div>
  `;
}

function authMethodSelectionModal() {
  return `
    <div class="modal-backdrop">
      <section class="entry-modal auth-selection-modal" role="dialog" aria-modal="true" aria-labelledby="auth-selection-title">
        <header class="modal-header">
          <button class="modal-icon" id="cancel-auth-selection" title="Tancar">${icon("X", 20)}</button>
          <h2 id="auth-selection-title">Tria el mètode d'autenticació</h2>
        </header>
        <div class="modal-scroll">
          <div class="auth-method-options">
            <button class="auth-method-card ${state.authMethodSelected === "password" ? "selected" : ""}" id="auth-method-password">
              ${icon("LockKeyhole", 32)}
              <h3>Contrasenya mestra</h3>
              <p>Utilitza una contrasenya text per obrir la caixa forta.</p>
            </button>
            <button class="auth-method-card ${state.authMethodSelected === "image" ? "selected" : ""}" id="auth-method-image">
              ${icon("Camera", 32)}
              <h3>Autenticació amb imatge</h3>
              <p>Utilitza una imatge i punts de clic per autenticar-te.</p>
            </button>
          </div>
          ${state.gridSetupError ? `<p class="error" id="image-auth-setup-error">${escapeHtml(state.gridSetupError)}</p>` : ""}
        </div>
        <footer class="modal-footer">
          <button type="button" class="secondary" id="cancel-auth-selection-bottom">Cancel·la</button>
          <button type="button" class="primary" id="continue-auth-selection">Continuar ${icon("ArrowRight", 17)}</button>
        </footer>
      </section>
    </div>
  `;
}

function imageAuthSetupModal() {
  return `
    <div class="modal-backdrop image-auth-modal-backdrop">
      <section class="entry-modal image-auth-setup-modal" role="dialog" aria-modal="true" aria-labelledby="image-auth-setup-title">
        <header class="modal-header">
          <button class="modal-icon" id="cancel-image-auth-setup" title="Tancar">${icon("X", 20)}</button>
          <h2 id="image-auth-setup-title">Configura la teva autenticació amb imatge</h2>
        </header>
        <div class="modal-scroll">
          <div class="image-auth-instructions">
            <p>Puja una imatge i marca els punts fent clic o dibuixant-hi a sobre.</p>
            <p class="hint">Selecciona almenys 5 punts; l'ordre forma la contrasenya.</p>
          </div>
          <div class="image-upload-area" id="image-upload-area" style="${state.imageAuthImage ? "display:none;" : ""}">
            <p>${icon("Camera", 40)}</p>
            <p>Fes clic per pujar la teva imatge</p>
            <input type="file" accept="image/*" id="image-auth-upload" style="display:none;" />
          </div>
          <div class="image-auth-canvas-area" id="image-auth-canvas-area" style="${state.imageAuthImage ? "" : "display:none;"}">
            <canvas id="image-auth-canvas" width="500" height="400"></canvas>
            <p class="image-auth-status">Punts seleccionats: <strong id="image-auth-count">0</strong></p>
            <p class="image-auth-order">Ordre dels punts: <strong id="image-auth-order">cap</strong></p>
            <div class="image-auth-point-actions">
              <button type="button" class="secondary" id="undo-image-auth-point">${icon("Undo2", 17)} Enrere</button>
              <button type="button" class="secondary" id="clear-image-auth-points">${icon("Eraser", 17)} Esborra selecció</button>
            </div>
          </div>
          ${state.gridSetupError ? `<p class="error">${escapeHtml(state.gridSetupError)}</p>` : ""}
        </div>
        <footer class="modal-footer">
          <button type="button" class="secondary" id="cancel-image-auth-setup-bottom">Cancel·la</button>
          <button type="button" class="primary" id="save-image-auth-setup">Desa el patró</button>
        </footer>
      </section>
    </div>
  `;
}

function imageAuthUnlockModal() {
  const persistedImage = localStorage.getItem("image_auth_image") || "";
  return `
    <div class="modal-backdrop image-auth-modal-backdrop">
      <section class="entry-modal image-auth-unlock-modal" role="dialog" aria-modal="true" aria-labelledby="image-auth-unlock-title">
        <header class="modal-header">
          <button class="modal-icon" id="cancel-image-auth-unlock" title="Tancar">${icon("X", 20)}</button>
          <h2 id="image-auth-unlock-title">Desbloqueja amb la teva imatge</h2>
        </header>
        <div class="modal-scroll">
          <div class="image-auth-instructions">
            <p>Marca almenys 5 punts a la imatge, en el mateix ordre.</p>
          </div>
          <div class="image-auth-canvas-area">
            <canvas id="image-auth-unlock-canvas" class="${state.loading ? "is-unlocking" : ""}" width="500" height="400"></canvas>
            <p class="image-auth-status">Punts seleccionats: <strong id="image-auth-unlock-count">0</strong></p>
            <p class="image-auth-order">Ordre dels punts: <strong id="image-auth-unlock-order">cap</strong></p>
            <div class="image-auth-point-actions">
              <button type="button" class="secondary" id="undo-image-auth-unlock-point" ${state.loading ? "disabled" : ""}>${icon("Undo2", 17)} Enrere</button>
              <button type="button" class="secondary" id="clear-image-auth-unlock-points" ${state.loading ? "disabled" : ""}>${icon("Eraser", 17)} Esborra selecció</button>
            </div>
            ${
              state.loading
                ? `
              <div class="unlock-loading" role="status" aria-live="polite">
                <div class="unlock-progress-track" role="progressbar" aria-label="Desxifrant la caixa forta" aria-valuetext="En curs">
                  <span class="unlock-progress-indicator"></span>
                </div>
                <span>Verificant el patró i desxifrant la caixa forta…</span>
              </div>
            `
                : ""
            }
          </div>
          ${state.gridUnlockError ? `<p class="error">${escapeHtml(state.gridUnlockError)}</p>` : ""}
        </div>
        <footer class="modal-footer">
          <button type="button" class="secondary" id="cancel-image-auth-unlock-bottom" ${state.loading ? "disabled" : ""}>Cancel·la</button>
          <button type="button" class="primary" id="verify-image-auth-unlock" ${state.loading ? "disabled" : ""}>${state.loading ? "Desbloquejant…" : "Verifica i desbloqueja"}</button>
        </footer>
      </section>
    </div>
  `;
}

function changeAuthMethodModal() {
  return `
    <div class="modal-backdrop">
      <section class="entry-modal change-auth-modal" role="dialog" aria-modal="true" aria-labelledby="change-auth-title">
        <header class="modal-header">
          <button class="modal-icon" id="cancel-change-auth" title="Tancar">${icon("X", 20)}</button>
          <h2 id="change-auth-title">Canvia la contrasenya o l'autenticació</h2>
        </header>
        <div class="modal-scroll">
          <div class="auth-method-options">
            <button type="button" class="auth-method-card ${state.changeAuthSelected === "password" ? "selected" : ""}" id="change-auth-password">
              ${icon("LockKeyhole", 32)}
              <h3>Contrasenya mestra</h3>
              <p>Tria una contrasenya mestra nova per obrir la caixa forta.</p>
            </button>
            <button type="button" class="auth-method-card ${state.changeAuthSelected === "image" ? "selected" : ""}" id="change-auth-image">
              ${icon("Camera", 32)}
              <h3>Autenticació amb imatge</h3>
              <p>Utilitza una imatge i punts de clic per autenticar-te.</p>
            </button>
          </div>
          ${
            state.changeAuthSelected === "password"
              ? `
            <div class="change-auth-password-fields">
              <p class="helper">La caixa es tornarà a xifrar. Tria una contrasenya nova de 12 caràcters com a mínim.</p>
              <label class="form-label" for="change-auth-new-password">Contrasenya mestra nova</label>
              <input class="form-input" id="change-auth-new-password" type="password" autocomplete="new-password" minlength="12" required />
              <label class="form-label" for="change-auth-confirm-password">Confirma la contrasenya nova</label>
              <input class="form-input" id="change-auth-confirm-password" type="password" autocomplete="new-password" minlength="12" required />
            </div>
          `
              : ""
          }
          <p class="error" id="change-auth-error" ${state.changeAuthError ? "" : "hidden"}>${escapeHtml(state.changeAuthError)}</p>
        </div>
        <footer class="modal-footer">
          <button type="button" class="secondary" id="cancel-change-auth-bottom">Cancel·la</button>
          <button type="button" class="primary" id="save-auth-method" ${state.changeAuthBusy ? "disabled" : ""}>${state.changeAuthBusy ? "Canviant..." : state.changeAuthSelected === "image" ? "Continua amb imatge" : "Canvia la contrasenya"}</button>
        </footer>
      </section>
    </div>
  `;
}

function firstEntryGuideModal() {
  const step = state.firstEntryGuideStep;
  const stepContent =
    {
      1: {
        kicker: "PAS 1 DE 5",
        title: "Comença aquí",
        text: "Fes clic al botó «Nou accés» per començar a guardar el teu primer servei.",
      },
      2: {
        kicker: "PAS 2 DE 5",
        title: "Afegeix les dades",
        text: "Escriu el nom del servei. Després t'ensenyarem a crear una contrasenya segura.",
      },
      3: {
        kicker: "PAS 3 DE 5",
        title: "Genera una contrasenya segura",
        text: "Fes clic a la icona de regenerar del camp de contrasenya per obrir el generador.",
      },
      4: {
        kicker: "PAS 4 DE 5",
        title: "Utilitza la contrasenya",
        text: "Revisa la suggerencia i prem «Utilitza aquesta contrasenya» per tornar al formulari.",
      },
      5: {
        kicker: "PAS 5 DE 5",
        title: "Desa el teu accés",
        text: "Quan hagis completat els camps obligatoris, fes clic a la icona de confirmació per desar-lo.",
      },
    }[step] || {};

  return `
    <div class="guide-layer" role="dialog" aria-modal="false" aria-labelledby="first-entry-guide-title">
      <section class="guide-callout guide-callout-${step}" aria-live="polite">
        <div class="guide-callout-arrow"></div>
        <div class="guide-callout-header">
          <span class="guide-kicker"><span class="guide-kicker-dot"></span> ${stepContent.kicker}</span>
          <button type="button" class="guide-close" id="dismiss-entry-guide" title="Tancar la guia">
            ${icon("X", 18)}
          </button>
        </div>
        <h2 id="first-entry-guide-title">${stepContent.title}</h2>
        <p>${stepContent.text}</p>
        ${step === 2 ? `<button type="button" class="guide-next" id="guide-next-step">Continuar ${icon("ArrowRight", 16)}</button>` : ""}
      </section>
    </div>
  `;
}

function vaultScreen() {
  const filtered = state.entries.filter(
    (entry) =>
      (!state.activeFolderId || entry.folderId === state.activeFolderId) &&
      `${entry.site} ${entry.username}`.toLowerCase().includes(state.query),
  );

  return `
    <main class="shell">
      ${sidebarComponent()}
      <section class="workspace">
        <header class="topbar">
          <div>
            <p class="eyebrow">LA TEVA CAIXA FORTA</p>
            <h1>Les teves contrasenyes</h1>
            <p class="subtitle">Tot el que necessites, protegit i a mà.</p>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="lock-button" id="refresh-vault" title="Actualitzar accessos">
              ${icon("RotateCw", 17)}
            </button>
            <button class="lock-button" id="lock-vault" title="Bloquejar la caixa forta">
              ${icon("LockKeyhole", 17)}
            </button>
          </div>
        </header>

        <div class="toolbar">
          <label class="search">
            ${icon("Search", 18)}
            <input
              id="search"
              placeholder="Cerca per lloc o usuari"
              value="${escapeHtml(state.query)}"
            />
            <kbd class="search-shortcut">Ctrl/⌘ Shift P</kbd>
          </label>
          <button class="primary ${state.showFirstEntryGuide && state.firstEntryGuideStep === 1 ? "guide-highlight" : ""}" id="new-entry">
            ${icon("Plus", 17)} Nou accés
          </button>
        </div>

        <div class="list-header">
          <span>${filtered.length} ${filtered.length === 1 ? "accés" : "accessos"}</span>
        </div>

        <div class="entries">
          ${
            filtered.length
              ? filtered.map(entryCard).join("")
              : `
              <div class="empty">
                ${icon("Vault", 28)}
                <h2>${state.entries.length ? "No s'ha trobat cap accés" : "La teva caixa forta està buida"}</h2>
                <p>${state.entries.length ? "Prova una altra cerca." : "Comença afegint el teu primer accés."}</p>
                <button class="primary" id="empty-new">
                  ${icon("Plus", 16)} Crear accés
                </button>
              </div>
              `
          }
        </div>

        ${
          !state.entries.length
            ? `
              <button class="guide-launcher" id="open-entry-guide" type="button">
                ${icon("Sparkles", 16)} Veure la guia
              </button>
            `
            : ""
        }

        ${bottomNavComponent("vault")}
      </section>
    </main>

    ${state.viewingEntryId ? entryDetailsModal() : ""}
    ${state.showEntryForm ? entryFormModal() : ""}
    ${state.showFirstEntryGuide ? firstEntryGuideModal() : ""}
    ${state.showTrashModal ? trashModal() : ""}
    ${state.showFolderModal ? folderModal() : ""}
  `;
}

function generatorScreen() {
  const isPassword = state.generatorType === "password";
  const isPassphrase = state.generatorType === "passphrase";
  const currentLang = state.generatorLanguage;

  return `
    <main class="generator-shell">
      <header class="generator-header">
        <div>
          <p class="eyebrow">EINES DE SEGURETAT</p>
          <h1>Generador</h1>
          <p class="subtitle">Crea credencials úniques i desa l'historial dins de la caixa forta.</p>
        </div>
        <button class="lock-button" id="lock-vault" title="Bloquejar la caixa forta">
          ${icon("LockKeyhole", 17)}
        </button>
      </header>

      <div class="generator-content">
        <div class="generator-tabs">
          <button class="generator-tab ${isPassword ? "active" : ""}" data-generator-type="password">
            Contrasenya
          </button>
          <button class="generator-tab ${isPassphrase ? "active" : ""}" data-generator-type="passphrase">
            Frase de pas
          </button>
          <button class="generator-tab ${!isPassword && !isPassphrase ? "active" : ""}" data-generator-type="username">
            Nom d'usuari
          </button>
        </div>

        <section class="generated-card">
          <output class="generated-value" draggable="true" title="Arrossega-la a un camp de text">${escapeHtml(state.generatedValue || generateValue())}</output>
          <button class="icon-btn" id="regenerate" title="Regenerar">
            ${icon("RefreshCw", 20)}
          </button>
          <button class="icon-btn" id="copy-generated" title="Copiar">
            ${icon("Copy", 20)}
          </button>
        </section>

        ${
          isPassword
            ? `
            <button class="use-generated primary ${state.showFirstEntryGuide && state.firstEntryGuideStep === 4 ? "guide-highlight" : ""}" id="use-generated">
              ${icon("Check", 17)} Utilitza aquesta contrasenya
            </button>
            `
            : ""
        }

        <section class="generator-options">
          <div class="options-title">
            <h2>Opcions</h2>
            <label>
              ${icon("Languages", 16)} Idioma
              <select id="generator-language">
                <option value="Català" ${currentLang === "Català" ? "selected" : ""}>Català</option>
                <option value="Castellà" ${currentLang === "Castellà" || currentLang === "Español" ? "selected" : ""}>Castellà</option>
                <option value="Anglès" ${currentLang === "Anglès" || currentLang === "English" ? "selected" : ""}>Anglès</option>
                <option value="Francès" ${currentLang === "Francès" || currentLang === "Français" ? "selected" : ""}>Francès</option>
              </select>
            </label>
          </div>
          ${isPassword ? passwordOptions() : isPassphrase ? passphraseOptions() : usernameOptions()}
        </section>

        <section class="history-section">
          <div class="history-heading">
            <h2>Historial del generador</h2>
            <button class="icon-btn" id="clear-history" title="Buidar l'historial">
              ${icon("Trash2", 17)}
            </button>
          </div>
          ${
            state.history.length
              ? state.history.map(historyItem).join("")
              : '<p class="history-empty">Les generacions apareixeran aquí.</p>'
          }
        </section>
      </div>

      ${bottomNavComponent("generator")}
    </main>
    ${state.showFirstEntryGuide ? firstEntryGuideModal() : ""}
  `;
}

function settingsScreen() {
  const fontSizeValue = Number(state.settings.fontSize) || 16;

  return `
    <main class="settings-shell">
      <header class="settings-header">
        <div>
          <p class="eyebrow">PREFERÈNCIES</p>
          <h1>Configuració</h1>
          <p class="subtitle">Adapta la Caixa Forta a la teva manera de treballar.</p>
        </div>
        <button class="lock-button" id="lock-vault" title="Bloquejar la caixa forta">
          ${icon("LockKeyhole", 17)}
        </button>
      </header>

      <div class="settings-content">
        <section class="settings-section">
          <div class="settings-section-title">
            ${icon("ShieldCheck", 19)}
            <h2>Seguretat de la caixa forta</h2>
          </div>
          <label class="setting-row">
            <span>
              <strong>Temps de bloqueig automàtic</strong>
              <small>Bloqueja la caixa després d'un període d'inactivitat.</small>
            </span>
            <select id="auto-lock">
              <option value="never">Mai</option>
              <option value="5">5 minuts</option>
              <option value="15">15 minuts</option>
              <option value="30">30 minuts</option>
            </select>
          </label>
          <button class="setting-action" id="change-auth-method">
            ${icon("KeyRound", 18)} Canvia la contrasenya o l'autenticació
          </button>
        </section>

        <section class="settings-section">
          <div class="settings-section-title">
            ${icon("Vault", 19)}
            <h2>Opcions de la caixa forta</h2>
          </div>
          <div class="settings-actions">
            <button class="setting-action" id="import-vault" title="Importa un fitxer JSON o CSV">
              ${icon("Upload", 18)} Importar JSON / CSV
            </button>
            <button class="setting-action" id="export-vault">
              ${icon("Download", 18)} Exportar
            </button>
            <button class="setting-action" id="open-trash">
              ${icon("Trash2", 18)} Paperera <b>${state.trash.length}</b>
            </button>
          </div>
          <button type="button" class="setting-action danger-btn" id="reset-vault">
            ${icon("RotateCcw", 18)} Eliminar dades locals i començar de nou
          </button>
          <input id="import-file" type="file" accept=".json,.csv,application/json,text/csv" hidden />
        </section>

        <section class="settings-section">
          <div class="settings-section-title">
            ${icon("Cloud", 19)}
            <h2>Inici de sessió al núvol</h2>
          </div>
          <p class="helper">Connecta amb el teu vault de Railway per descarregar-lo o sincronitzar-lo.</p>
          <button class="setting-action" id="open-cloud-login">
            ${icon("Cloud", 18)} Configura Railway
          </button>
        </section>

        <section class="settings-section">
          <div class="settings-section-title">
            ${icon("Palette", 19)}
            <h2>Aparença</h2>
          </div>
          <label class="setting-row">
            <span>
              <strong>Tema</strong>
              <small>Automàtic segueix l'aparença del sistema.</small>
            </span>
            <select id="theme-setting">
              <option value="auto">Automàtic</option>
              <option value="light">Clar</option>
              <option value="dark">Obscur</option>
            </select>
          </label>
          <div class="setting-row">
            <span>
              <strong>Mida de la lletra</strong>
              <small>Augmenta o redueix la mida del text en temps real.</small>
            </span>
            <div class="slider-wrapper">
              <input
                id="font-size-setting"
                type="range"
                min="12"
                max="22"
                step="1"
                value="${fontSizeValue}"
              />
              <output id="font-size-value">${fontSizeValue} px</output>
            </div>
          </div>
          <div class="setting-row">
            <span>
              <strong>Color de l'aplicació</strong>
              <small>Tria el color principal de la interfície.</small>
            </span>
            <div class="color-options">
              <button class="color-swatch blue" data-accent="blue" title="Blau"></button>
              <button class="color-swatch green" data-accent="green" title="Verd"></button>
              <button class="color-swatch orange" data-accent="orange" title="Taronja"></button>
              <button class="color-swatch red" data-accent="red" title="Vermell"></button>
            </div>
          </div>
        </section>
      </div>

      ${bottomNavComponent("settings")}
    </main>

    ${state.showTrashModal ? trashModal() : ""}
    ${state.showChangeAuthModal ? changeAuthMethodModal() : ""}
    ${state.showGridSetup ? imageAuthSetupModal() : ""}
    ${state.showResetConfirm ? resetConfirmModal() : ""}
    ${state.showCloudLogin ? cloudLoginModal() : ""}
  `;
}

function entryDetailsModal() {
  const entry = state.entries.find((e) => e.id === state.viewingEntryId);
  if (!entry) return "";
  const { url, cleanNotes } = parseEntryNotes(entry.notes);

  return `
    <div class="modal-backdrop">
      <section class="entry-modal entry-details-modal" role="dialog" aria-modal="true" aria-labelledby="details-title">
        <header class="modal-header">
          <button class="modal-icon" id="close-details" title="Tancar">
            ${icon("X", 20)}
          </button>
          <h2 id="details-title">${escapeHtml(entry.site)}</h2>
          <div class="modal-header-actions">
            <button class="modal-icon" id="edit-entry-btn" title="Editar l'accés">
              ${icon("Pencil", 19)}
            </button>
            <button type="button" class="modal-icon danger" id="delete-entry-btn" title="Moure a la paperera">
              ${icon("Trash2", 19)}
            </button>
          </div>
        </header>

        <div class="modal-scroll">
          <div class="details-hero">
            <div class="site-badge large">${icon("Globe", 28)}</div>
            <div class="details-hero-text">
              <h3>${escapeHtml(entry.site)}</h3>
              <span>${entry.username ? escapeHtml(entry.username) : "Sense nom d'usuari"}</span>
            </div>
          </div>

          <div class="detail-group">
            <label class="detail-label">Nom d'usuari</label>
            <div class="detail-field">
              <input class="detail-input" readonly value="${escapeHtml(entry.username)}" />
              <button class="icon-btn" data-copy-text="${escapeHtml(entry.username)}" title="Copiar l'usuari">
                ${icon("Copy", 17)}
              </button>
            </div>
          </div>

          <div class="detail-group">
            <label class="detail-label">Contrasenya</label>
            <div class="detail-field">
              <input
                class="detail-input"
                id="details-password"
                type="password"
                readonly
                value="${escapeHtml(entry.password)}"
              />
              <button class="icon-btn" id="reveal-details-password" title="Mostrar/ocultar la contrasenya">
                ${icon("Eye", 17)}
              </button>
              <button class="icon-btn" data-copy-text="${escapeHtml(entry.password)}" title="Copiar la contrasenya">
                ${icon("Copy", 17)}
              </button>
            </div>
          </div>

          ${
            url
              ? `
              <div class="detail-group">
                <label class="detail-label">Lloc web</label>
                <div class="detail-field">
                  <input class="detail-input" readonly value="${escapeHtml(url)}" />
                  <button class="icon-btn" data-open="${escapeHtml(url)}" title="Obrir al navegador">
                    ${icon("ExternalLink", 17)}
                  </button>
                  <button class="icon-btn" data-copy-text="${escapeHtml(url)}" title="Copiar l'enllaç">
                    ${icon("Copy", 17)}
                  </button>
                </div>
              </div>
              `
              : ""
          }

          ${
            cleanNotes
              ? `
              <div class="detail-group">
                <label class="detail-label">Notes</label>
                <div class="detail-notes">${escapeHtml(cleanNotes)}</div>
              </div>
              `
              : ""
          }

          <div class="detail-metadata">
            <span>Creat el ${formatDate(entry.createdAt)}</span>
            ${
              entry.updatedAt && entry.updatedAt !== entry.createdAt
                ? `<span>Actualitzat el ${formatDate(entry.updatedAt)}</span>`
                : ""
            }
          </div>
        </div>

        <footer class="modal-footer details-footer">
          <button type="button" class="danger-btn" id="delete-entry-bottom">
            ${icon("Trash2", 17)} Eliminar
          </button>
          <button type="button" class="primary" id="edit-entry-bottom">
            ${icon("Pencil", 17)} Editar
          </button>
        </footer>
      </section>
    </div>
  `;
}

function entryFormModal() {
  const isEditing = Boolean(state.editingEntryId);
  const entry = isEditing
    ? state.entries.find((e) => e.id === state.editingEntryId) || {}
    : {};
  const { url, cleanNotes } = parseEntryNotes(entry.notes || "");
  const draft = state.entryFormDraft || {};
  const values = {
    site: draft.site ?? entry.site ?? "",
    folderId: draft.folderId ?? entry.folderId ?? "",
    username: draft.username ?? entry.username ?? "",
    password: draft.password ?? entry.password ?? "",
    url: draft.url ?? url ?? "",
    notes: draft.notes ?? cleanNotes ?? "",
  };

  return `
    <div class="modal-backdrop">
      <section class="entry-modal" role="dialog" aria-modal="true" aria-labelledby="entry-title">
        <header class="modal-header">
          <button class="modal-icon" id="cancel-entry" title="Tornar">
            ${icon("X", 20)}
          </button>
          <h2 id="entry-title">${isEditing ? "Editar accés" : "Nou accés"}</h2>
          <button class="modal-icon ${state.showFirstEntryGuide && state.firstEntryGuideStep === 5 ? "guide-highlight" : ""}" id="save-entry-top" title="Desar">
            ${icon("Check", 20)}
          </button>
        </header>

        <form id="entry-form">
          <div class="modal-scroll">
            <section class="form-section">
              <div class="section-heading">
                <span>Detalls de l'element</span>
                ${icon("Star", 18)}
              </div>
              <label class="form-label" for="entry-name">Nom de l'element <b>*</b></label>
              <input
                class="form-input ${state.showFirstEntryGuide && state.firstEntryGuideStep === 2 ? "guide-highlight" : ""}"
                id="entry-name"
                name="name"
                required
                autofocus
                placeholder="Ex. YouTube"
                value="${escapeHtml(values.site)}"
              />

              <label class="form-label" for="entry-folder">Carpeta</label>
              <select class="form-input" id="entry-folder" name="folder">
                <option value="">Sense carpeta</option>
                ${state.folders.map((folder) => `<option value="${escapeHtml(folder.id)}" ${values.folderId === folder.id ? "selected" : ""}>${escapeHtml(folder.name)}</option>`).join("")}
              </select>
            </section>

            <section class="form-section">
              <h3>Credencials d'inici de sessió</h3>
              <label class="form-label" for="entry-username">Nom d'usuari</label>
              <input
                class="form-input"
                id="entry-username"
                name="username"
                autocomplete="username"
                value="${escapeHtml(values.username)}"
              />

              <label class="form-label" for="entry-password">Contrasenya <b>*</b></label>
              <div class="input-with-actions">
                <input
                  class="form-input"
                  id="entry-password"
                  name="password"
                  type="password"
                  required
                  autocomplete="new-password"
                  value="${escapeHtml(values.password)}"
                />
                <button type="button" class="field-action" id="entry-password-reveal" title="Mostrar contrasenya">
                  ${icon("Eye", 18)}
                </button>
                <button type="button" class="field-action ${state.showFirstEntryGuide && state.firstEntryGuideStep === 3 ? "guide-highlight" : ""}" id="generate-password" title="Generar contrasenya">
                  ${icon("RefreshCw", 18)}
                </button>
              </div>
              <div class="inline-password-strength" id="entry-password-strength" ${values.password ? "" : "hidden"}>
                <div class="strength-label"><span>Força</span><strong>${values.password ? passwordStrength(values.password).label : ""}</strong></div>
                <div class="strength-track"><span class="strength-fill strength-${values.password ? passwordStrength(values.password).level : "weak"}" style="width:${values.password ? passwordStrength(values.password).percent : 0}%"></span></div>
                <small>${values.password ? passwordStrength(values.password).hint : ""}</small>
              </div>
              <small class="helper">
                La contrasenya està oculta. Utilitza el generador per crear-ne una de forta i única.
              </small>
            </section>

            <section class="form-section">
              <h3>Opcions d'emplenament automàtic</h3>
              <label class="form-label" for="entry-url">Lloc web (URL)</label>
              <input
                class="form-input"
                id="entry-url"
                name="url"
                type="url"
                placeholder="https://"
                value="${escapeHtml(values.url)}"
              />

              <h3>Opcions addicionals</h3>
              <label class="form-label" for="entry-notes">Notes</label>
              <textarea class="form-input notes-input" id="entry-notes" name="notes">${escapeHtml(values.notes)}</textarea>
            </section>

            ${state.formError ? `<p class="error form-error">${escapeHtml(state.formError)}</p>` : ""}
          </div>

          <footer class="modal-footer">
            <button type="button" class="secondary" id="cancel-entry-bottom">
              Cancel·la
            </button>
            <button type="submit" class="primary" ${state.saving ? "disabled" : ""}>
              ${state.saving ? "Desant..." : isEditing ? "Desar canvis" : "Guarda"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  `;
}

function trashModal() {
  return `
    <div class="modal-backdrop">
      <section class="entry-modal" role="dialog" aria-modal="true" aria-labelledby="trash-title">
        <header class="modal-header">
          <button class="modal-icon" id="close-trash" title="Tancar">
            ${icon("X", 20)}
          </button>
          <h2 id="trash-title">Paperera (${state.trash.length})</h2>
          ${
            state.trash.length
              ? `
              <button class="danger-btn" id="empty-trash-btn" style="height:32px;padding:0 10px;font-size:0.75rem">
                ${icon("Trash2", 15)} Buidar
              </button>
              `
              : ""
          }
        </header>

        <div class="modal-scroll">
          ${
            state.trash.length
              ? `<div class="trash-list">${state.trash.map(trashCard).join("")}</div>`
              : `
              <div class="empty">
                ${icon("Trash2", 28)}
                <h2>La paperera està buida</h2>
                <p>Els accessos eliminats apareixeran aquí abans d'esborrar-se definitivament.</p>
              </div>
              `
          }
        </div>

        <footer class="modal-footer">
          <button type="button" class="secondary" id="close-trash-bottom">
            Tancar
          </button>
        </footer>
      </section>
    </div>
  `;
}

function resetConfirmModal() {
  return `
    <div class="modal-backdrop">
      <section class="entry-modal" role="dialog" aria-modal="true" aria-labelledby="reset-vault-title">
        <header class="modal-header">
          <button class="modal-icon" id="cancel-reset-vault" title="Tancar">
            ${icon("X", 20)}
          </button>
          <h2 id="reset-vault-title">Eliminar dades locals?</h2>
        </header>
        <div class="modal-scroll">
          <p>Aquesta acció eliminarà la caixa forta local, la paperera i l'historial. No es pot desfer.</p>
        </div>
        <footer class="modal-footer">
          <button type="button" class="secondary" id="cancel-reset-vault-bottom">Cancel·la</button>
          <button type="button" class="danger-btn" id="confirm-reset-vault">
            ${icon("Trash2", 17)} Elimina les dades
          </button>
        </footer>
      </section>
    </div>
  `;
}

function cloudLoginModal() {
  const config = state.cloudConfig;
  const isOfficial = config.provider === "official" || !config.provider;
  return `
    <div class="modal-backdrop">
      <section class="entry-modal" role="dialog" aria-modal="true" aria-labelledby="cloud-login-title">
        <header class="modal-header">
          <button class="modal-icon" id="cancel-cloud-login" title="Tancar">${icon("X", 20)}</button>
          <h2 id="cloud-login-title">Autenticació al núvol</h2>
        </header>
        <form id="cloud-login-form">
          <div class="modal-scroll">
            <!-- Cloud Provider Selection -->
            <div class="form-section cloud-provider-section">
              <label class="form-label">Proveïdor de núvol:</label>
              <div class="input-group">
                <select class="form-input" id="cloud-provider" name="provider" ${isOfficial ? 'disabled style="opacity: 0.5"' : ""}>
                  <option value="official" ${isOfficial ? "selected" : ""}>Núvol oficial (recomanat)</option>
                  <option value="custom" ${!isOfficial ? "selected" : ""}>Personalitzat (domini propi)</option>
                </select>
                ${!isOfficial ? '<span class="provider-hint">Introdueix el teu propi domini Railway</span>' : ""}
              </div>
              ${!isOfficial ? `<div class="provider-hint">El núvol oficial no requereix configuració extra</div>` : ""}
            </div>
            
            <!-- Username/Email -->
            <div class="form-section auth-section">
              <label class="form-label" for="auth-username">Usuari o correu electrònic:</label>
              <input class="form-input" id="auth-username" name="username" type="text" required minlength="3" placeholder="E. g., joan.perez" ${isOfficial && !config.authUser ? "required" : ""} />
              ${state.cloudError ? `<p class="error form-error">${escapeHtml(state.cloudError)}</p>` : ""}
            </div>
            
            <!-- Master Password -->
            <div class="form-section master-password-section">
              <label class="form-label" for="auth-password">Contrasenya mestra:</label>
              <input class="form-input" id="auth-password" name="password" type="password" required minlength="16" placeholder="Mínim 16 caràcters" />
              <label class="form-label" for="auth-confirm-password">Confirma la contrasenya:</label>
              <input class="form-input" id="auth-confirm-password" name="confirmPassword" type="password" required minlength="16" placeholder="Repeteix la contrasenya" />
              <div class="privacy-note">
                🔒 Les teves contrasenyes estan encriptades amb AES-256-GCM. El servidor només emmagatzema la versió encriptada.
              </div>
            </div>
            
            <!-- Privacy Policy -->
            <div class="form-section privacy-section">
              <label class="form-checkbox" for="privacy-accepted">
                <input type="checkbox" id="privacy-accepted" name="privacyAccepted" required />
                He llegit i accepto la <a href="PRIVACY_POLICY.md" target="_blank" class="policy-link">Política de Privacitat</a>
              </label>
            </div>
          </div>
          <footer class="modal-footer">
            <button type="button" class="secondary" id="cancel-cloud-login">Cancel·la</button>
            <button type="button" class="secondary" id="register-cloud-vault" ${state.cloudLoading ? "disabled" : ""}>Registra't</button>
            <button type="button" class="secondary" id="download-cloud-vault" ${state.cloudLoading ? "disabled" : ""}>Connexió següent</button>
            <button type="submit" class="primary" ${state.cloudLoading ? "disabled" : ""}>${state.cloudLoading ? "Autenticant..." : isOfficial ? "Autentica" : "Configura núvol"}</button>
          </footer>
        </form>
      </section>
    </div>
  `;
}

function folderModal() {
  const folder = state.folders.find(
    (item) => item.id === state.editingFolderId,
  ) || {
    name: "",
    icon: "Folder",
    color: folderColors[0],
  };
  const isEditing = Boolean(state.editingFolderId);
  return `
    <div class="modal-backdrop">
      <section class="entry-modal folder-modal" role="dialog" aria-modal="true" aria-labelledby="folder-title">
        <header class="modal-header">
          <button class="modal-icon" id="cancel-folder" title="Tancar">${icon("X", 20)}</button>
          <h2 id="folder-title">${isEditing ? "Edita la carpeta" : "Crea una carpeta"}</h2>
        </header>
        <form id="folder-form">
          <div class="modal-scroll">
            <section class="form-section master-password-section">
              <label class="form-label" for="folder-name">Nom de la carpeta</label>
              <input class="form-input" id="folder-name" name="name" maxlength="80" required autofocus value="${escapeHtml(folder.name)}" placeholder="Ex. Feina" />

              <label class="form-label">Icona</label>
              <div class="folder-picker" role="group" aria-label="Icona de la carpeta">
                ${folderIcons.map((name) => `<button class="folder-choice ${folder.icon === name ? "selected" : ""}" type="button" data-folder-icon="${name}" title="${name}">${icon(name, 19)}</button>`).join("")}
              </div>
              <input type="hidden" id="folder-icon" name="icon" value="${escapeHtml(folder.icon)}" />

              <label class="form-label">Color</label>
              <div class="folder-picker" role="group" aria-label="Color de la carpeta">
                ${folderColors.map((color) => `<button class="folder-color ${folder.color === color ? "selected" : ""}" type="button" data-folder-color="${color}" style="--folder-color:${color}" title="${color}"></button>`).join("")}
              </div>
              <input type="hidden" id="folder-color" name="color" value="${escapeHtml(folder.color)}" />
              ${state.folderFormError ? `<p class="error form-error">${escapeHtml(state.folderFormError)}</p>` : ""}
            </section>
          </div>
          <footer class="modal-footer">
            <button type="button" class="secondary" id="cancel-folder-bottom">Cancel·la</button>
            <button type="submit" class="primary">${isEditing ? "Desar canvis" : "Crear carpeta"}</button>
          </footer>
        </form>
      </section>
    </div>
  `;
}

function trashCard(item) {
  return `
    <div class="trash-item">
      <div class="site-badge">${icon("Globe", 20)}</div>
      <div class="trash-info">
        <strong>${escapeHtml(item.site)}</strong>
        <span>${escapeHtml(item.username || "Sense nom d'usuari")}</span>
      </div>
      <div class="trash-actions">
        <button class="btn-restore" data-restore-trash="${item.id}" title="Restaurar l'accés">
          ${icon("RotateCcw", 14)} Restaura
        </button>
        <button class="btn-delete-perm" data-delete-perm="${item.id}" title="Eliminar definitivament">
          ${icon("Trash2", 14)}
        </button>
      </div>
    </div>
  `;
}

function historyItem(item) {
  return `
    <div class="history-item">
      <span class="history-kind">${escapeHtml(item.type)}</span>
      <code>${escapeHtml(item.value)}</code>
      <button class="icon-btn" data-copy-history="${escapeHtml(item.value)}" title="Copiar">
        ${icon("Copy", 16)}
      </button>
    </div>
  `;
}

function passwordOptions() {
  return `
    <label class="range-label">
      Longitud <output id="generator-length-value">${state.generatorOptions.length}</output>
      <input
        id="generator-length"
        type="range"
        min="5"
        max="128"
        value="${state.generatorOptions.length}"
      />
    </label>
    <div class="check-grid">
      <label>
        <input data-option="uppercase" type="checkbox" ${state.generatorOptions.uppercase ? "checked" : ""} />
        A-Z
      </label>
      <label>
        <input data-option="lowercase" type="checkbox" ${state.generatorOptions.lowercase ? "checked" : ""} />
        a-z
      </label>
      <label>
        <input data-option="numbers" type="checkbox" ${state.generatorOptions.numbers ? "checked" : ""} />
        0-9
      </label>
      <label>
        <input data-option="symbols" type="checkbox" ${state.generatorOptions.symbols ? "checked" : ""} />
        !@#$%&*
      </label>
    </div>
  `;
}

function passphraseOptions() {
  const maxWords = Math.max(3, Math.min(20, passphraseWordPool().length));
  return `
    <label>
      Nombre de paraules
      <input id="generator-words" type="number" min="3" max="${maxWords}" value="${Math.min(state.generatorOptions.words, maxWords)}" />
    </label>
    <label>
      Separador
      <input id="generator-separator" value="${escapeHtml(state.generatorOptions.separator)}" maxlength="3" />
    </label>
    <label class="check-label">
      <input data-option="uppercaseWords" type="checkbox" ${state.generatorOptions.uppercaseWords !== false ? "checked" : ""} />
      Majúscules inicials
    </label>
    <label class="check-label">
      <input data-option="includeNumber" type="checkbox" ${state.generatorOptions.includeNumber ? "checked" : ""} />
      Inclou número
    </label>
    <label class="check-label">
      <input data-option="removeAccents" type="checkbox" ${state.generatorOptions.removeAccents ? "checked" : ""} />
      Treure accents
    </label>
    <label class="check-label">
      <input data-option="onlyUnaccented" type="checkbox" ${state.generatorOptions.onlyUnaccented ? "checked" : ""} />
      Només paraules sense accents
    </label>
    <small class="helper">Cada paraula apareix una sola vegada.</small>
  `;
}

function usernameOptions() {
  return `
    <label>
      Format
      <select id="username-format">
        <option>Paraula aleatòria</option>
        <option>Nom i cognom</option>
        <option>Àlies amb números</option>
      </select>
    </label>
    <label class="check-label">
      <input data-option="uppercaseInitial" type="checkbox" ${state.generatorOptions.uppercaseInitial !== false ? "checked" : ""} />
      Majúscules inicials
    </label>
    <label class="check-label">
      <input data-option="includeNumber" type="checkbox" ${state.generatorOptions.includeNumber ? "checked" : ""} />
      Inclou número
    </label>
    <label class="check-label">
      <input data-option="removeAccents" type="checkbox" ${state.generatorOptions.removeAccents ? "checked" : ""} />
      Treure accents
    </label>
    <label class="check-label">
      <input data-option="onlyUnaccented" type="checkbox" ${state.generatorOptions.onlyUnaccented ? "checked" : ""} />
      Només paraules sense accents
    </label>
  `;
}

const wordsByLanguage = {
  Català: [
    "núvol",
    "riu",
    "llum",
    "bosc",
    "mar",
    "lluna",
    "vent",
    "foc",
    "camí",
    "estrella",
  ],
  Castellà: [
    "nube",
    "rio",
    "luz",
    "bosque",
    "mar",
    "luna",
    "viento",
    "fuego",
    "camino",
    "estrella",
  ],
  Español: [
    "nube",
    "rio",
    "luz",
    "bosque",
    "mar",
    "luna",
    "viento",
    "fuego",
    "camino",
    "estrella",
  ],
  Anglès: [
    "cloud",
    "river",
    "light",
    "forest",
    "moon",
    "wind",
    "fire",
    "path",
    "star",
    "meadow",
  ],
  English: [
    "cloud",
    "river",
    "light",
    "forest",
    "moon",
    "wind",
    "fire",
    "path",
    "star",
    "meadow",
  ],
  Francès: [
    "nuage",
    "rivière",
    "lumière",
    "forêt",
    "lune",
    "vent",
    "feu",
    "chemin",
    "étoile",
    "prairie",
  ],
  Français: [
    "nuage",
    "rivière",
    "lumière",
    "forêt",
    "lune",
    "vent",
    "feu",
    "chemin",
    "étoile",
    "prairie",
  ],
};

function randomItem(items) {
  return items[secureRandomIndex(items.length)];
}

function secureRandomIndex(max) {
  if (!Number.isSafeInteger(max) || max < 1)
    throw new Error("Límit aleatori no vàlid.");
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const values = new Uint32Array(1);
  do {
    crypto.getRandomValues(values);
  } while (values[0] >= limit);
  return values[0] % max;
}

function withoutAccents(word) {
  return word.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function generatorWords() {
  const words =
    wordsByLanguage[state.generatorLanguage] ||
    wordsByLanguage.Català ||
    wordsByLanguage.Anglès;
  const available = state.generatorOptions.onlyUnaccented
    ? words.filter((word) => word === withoutAccents(word))
    : words;
  return available.length ? available : words;
}

function formatGeneratorWord(word) {
  return state.generatorOptions.removeAccents ? withoutAccents(word) : word;
}

function passphraseWordPool() {
  const seen = new Set();
  return generatorWords().reduce((pool, word) => {
    const formatted = formatGeneratorWord(word);
    const displayWord =
      state.generatorOptions.uppercaseWords === false
        ? formatted
        : formatted.charAt(0).toUpperCase() + formatted.slice(1);
    const key = displayWord.normalize("NFC").toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      pool.push(displayWord);
    }
    return pool;
  }, []);
}

function generateValue() {
  if (state.generatorType === "password") {
    const characterSets = [
      state.generatorOptions.uppercase && "ABCDEFGHJKLMNPQRSTUVWXYZ",
      state.generatorOptions.lowercase && "abcdefghijkmnopqrstuvwxyz",
      state.generatorOptions.numbers && "23456789",
      state.generatorOptions.symbols && "!@#$%^&*",
    ].filter(Boolean);
    const sets = characterSets.length
      ? characterSets
      : ["abcdefghijkmnopqrstuvwxyz"];
    const alphabet = sets.join("");
    const characters = sets.map((set) => set[secureRandomIndex(set.length)]);
    while (characters.length < state.generatorOptions.length) {
      characters.push(alphabet[secureRandomIndex(alphabet.length)]);
    }
    for (let index = characters.length - 1; index > 0; index -= 1) {
      const swapIndex = secureRandomIndex(index + 1);
      [characters[index], characters[swapIndex]] = [
        characters[swapIndex],
        characters[index],
      ];
    }
    return characters.join("");
  }
  if (state.generatorType === "passphrase") {
    const words = passphraseWordPool();
    for (let index = words.length - 1; index > 0; index -= 1) {
      const swapIndex = secureRandomIndex(index + 1);
      [words[index], words[swapIndex]] = [words[swapIndex], words[index]];
    }
    const wordCount = Math.min(state.generatorOptions.words, words.length);
    state.generatorOptions.words = wordCount;
    const value = words
      .slice(0, wordCount)
      .join(state.generatorOptions.separator);
    return state.generatorOptions.includeNumber
      ? `${value}${secureRandomIndex(10)}`
      : value;
  }
  const words = generatorWords();
  const value = `${formatGeneratorWord(randomItem(words))}${formatGeneratorWord(randomItem(words))}`;
  return state.generatorOptions.includeNumber
    ? `${value}${secureRandomIndex(100)}`
    : value;
}

function updateGeneratorOptions(event) {
  if (event.target.dataset.option)
    state.generatorOptions[event.target.dataset.option] = event.target.checked;
  if (event.target.id === "generator-length")
    state.generatorOptions.length = Math.min(
      128,
      Math.max(5, Number(event.target.value) || 20),
    );
  if (event.target.id === "generator-words")
    state.generatorOptions.words = Math.min(
      Math.max(3, Math.min(20, passphraseWordPool().length)),
      Math.max(3, Number(event.target.value) || 6),
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

async function copySensitiveText(value, successMessage, button = null) {
  try {
    await navigator.clipboard.writeText(value);
  } catch (error) {
    showToast(`No s'ha pogut copiar: ${error}`);
    return false;
  }

  const feedbackTarget = button?.id
    ? `#${CSS.escape(button.id)}`
    : button?.dataset.copy
      ? `[data-copy="${CSS.escape(button.dataset.copy)}"]`
      : null;
  showToast(successMessage);
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

function passwordStrength(password) {
  let score = 0;
  if (password.length >= 12) score++;
  if (password.length >= 20) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  const levels = [
    {
      level: "weak",
      label: "Feble",
      hint: "Afegeix longitud i varietat de caràcters.",
      percent: 20,
    },
    {
      level: "fair",
      label: "Acceptable",
      hint: "Millorable amb més longitud o símbols.",
      percent: 45,
    },
    {
      level: "good",
      label: "Bona",
      hint: "Una contrasenya raonablement resistent.",
      percent: 70,
    },
    {
      level: "strong",
      label: "Molt forta",
      hint: "Bona combinació de longitud i varietat.",
      percent: 100,
    },
  ];
  return levels[Math.min(levels.length - 1, Math.max(0, score - 1))];
}
function updateEntryStrength(password) {
  const meter = document.querySelector("#entry-password-strength");
  if (!meter) return;
  meter.hidden = !password;
  if (!password) return;
  const strength = passwordStrength(password);
  meter.dataset.strength = strength.level;
  meter.querySelector(".strength-fill").style.width = `${strength.percent}%`;
  meter.querySelector(".strength-fill").className =
    `strength-fill strength-${strength.level}`;
  meter.querySelector("strong").textContent = strength.label;
  meter.querySelector("small").textContent = strength.hint;
}

async function unlock(event) {
  event.preventDefault();
  if (!isTauriRuntime()) {
    state.error =
      "Obre la Caixa Forta amb `Obrir_Caixa_Forta.command` per crear o desbloquejar la caixa forta.";
    render();
    return;
  }
  const input = document.querySelector("#master-password");
  const masterPassword = input.value;
  state.error = "";
  state.loading = true;
  render();
  try {
    const result = await invoke("unlock_vault", { masterPassword });
    state.masterPassword = masterPassword;
    state.entries = (result.entries || []).map((entry) => ({
      ...entry,
      folderId: entry.folder_id || entry.folderId || null,
      createdAt: entry.created_at || entry.createdAt,
      updatedAt: entry.updated_at || entry.updatedAt || null,
    }));
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
      await saveVault(masterPassword, true);
      state.showFirstEntryGuide = true;
    }
  } catch (error) {
    state.error = String(error);
  } finally {
    state.loading = false;
    render();
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

async function saveVault(masterPassword = null, syncToRailway = false) {
  const entries = state.entries.map((e) => ({
    id: e.id,
    site: e.site,
    username: e.username,
    password: e.password,
    notes: e.notes,
    folder_id: e.folderId || null,
    created_at: e.createdAt,
    updated_at: e.updatedAt || null,
    deleted_at: null,
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

  let password = masterPassword || state.masterPassword;
  if (!password) {
    try {
      const stored = localStorage.getItem("caixa-forta-master-password");
      password = stored ? stored : prompt("Please enter your master password:");
    } catch (e) {
      showToast("Cannot access secure storage. Please re-enter password.");
      throw new Error("Secure storage not available");
    }
  }

  if (!password || password.length < 12) {
    showToast("Master password is too short");
    throw new Error("Master password must be at least 12 characters");
  }

  try {
    await invoke("save_vault", {
      masterPassword: password,
      entries,
      history,
      trash,
      folders,
      syncToRailway,
    });
    if (masterPassword === null) {
      try {
        localStorage.setItem("caixa-forta-master-password", password);
      } catch (e) {}
    }
  } catch (error) {
    showToast(`Error saving vault: ${error}`);
    throw error;
  }
}

function readImportValue(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && (character === "," || character === ";")) {
      row.push(field);
      field = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  if (quoted) throw new Error("El CSV conté cometes sense tancar.");
  if (rows.length < 2)
    throw new Error("El CSV no conté cap accés per importar.");

  const headers = rows.shift().map((header) =>
    header
      .trim()
      .replace(/^\uFEFF/, "")
      .toLowerCase(),
  );
  return rows.map((values) =>
    Object.fromEntries(
      headers.map((header, index) => [header, values[index] || ""]),
    ),
  );
}

function normalizeImportedEntries(records) {
  if (!Array.isArray(records) || records.length > 10_000) {
    throw new Error("El fitxer supera el límit de 10.000 accessos.");
  }
  const now = new Date().toISOString();
  const ids = new Set();
  let skipped = 0;
  const entries = records.flatMap((record) => {
    if (!record || typeof record !== "object") {
      skipped += 1;
      return [];
    }
    const login =
      record.login && typeof record.login === "object" ? record.login : {};
    const url = (
      readImportValue(record, ["url", "website", "uri", "formactionorigin"]) ||
      readImportValue(login, ["uri", "url"]) ||
      String(login.uris?.[0]?.uri || "")
    ).trim();
    const password =
      readImportValue(record, ["password", "pass"]) ||
      readImportValue(login, ["password"]);
    const site = (
      readImportValue(record, ["site", "name", "title"]) ||
      url ||
      "Accés importat"
    ).trim();
    const username =
      readImportValue(record, ["username", "user", "email", "login"]) ||
      readImportValue(login, ["username"]);
    const notes = readImportValue(record, ["notes", "note"]);
    const savedNotes = url ? `URL: ${url}${notes ? `\n${notes}` : ""}` : notes;
    if (
      !password ||
      site.length > 4_096 ||
      username.length > 4_096 ||
      password.length > 16_384 ||
      savedNotes.length > 32_768 ||
      url.length > 4_000
    ) {
      skipped += 1;
      return [];
    }
    let id = readImportValue(record, ["id"]).trim();
    if (!id || ids.has(id)) id = crypto.randomUUID();
    ids.add(id);
    return [
      {
        id,
        site,
        username,
        password,
        notes: savedNotes,
        folderId: readImportValue(record, ["folderId", "folderid"]),
        createdAt: readImportValue(record, ["createdat"]) || now,
        updatedAt: readImportValue(record, ["updatedat"]) || now,
      },
    ];
  });
  if (!entries.length)
    throw new Error("No s'ha trobat cap accés vàlid al fitxer.");
  return { entries, skipped };
}

function normalizeImportedFolders(folders) {
  if (!Array.isArray(folders)) return [];
  const ids = new Set();
  return folders
    .flatMap((folder) => {
      const id = String(folder?.id || "").trim();
      const name = String(folder?.name || "").trim();
      if (!id || !name || ids.has(id) || name.length > 80) return [];
      ids.add(id);
      return [
        {
          id,
          name,
          icon: folderIcons.includes(folder.icon) ? folder.icon : "Folder",
          color: folderColors.includes(folder.color)
            ? folder.color
            : folderColors[0],
        },
      ];
    })
    .slice(0, 100);
}

async function persistImportedVault(
  entries,
  history,
  trash,
  folders,
  masterPassword,
) {
  if (masterPassword) {
    await saveVault(masterPassword);
  } else {
    await invoke("save_vault", { entries, history, trash, folders });
  }
}

function exportVault() {
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
  link.download = `caixa-forta-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("Còpia exportada. Desa-la en un lloc segur.");
}

async function importVault(event) {
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
      ? normalizeImportedFolders(data.folders)
      : [];
    const folderIds = new Set(folders.map((folder) => folder.id));
    entries.forEach((entry) => {
      if (!folderIds.has(entry.folderId)) entry.folderId = "";
    });
    await persistImportedVault(entries, history, trash, folders);
    state.entries = entries;
    state.history = history;
    state.trash = trash;
    state.folders = folders;
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
  state.showEntryForm = true;
  state.formError = "";
  render();
  document.querySelector("#entry-name")?.focus();
}

function openEditEntry(id) {
  state.viewingEntryId = null;
  state.editingEntryId = id;
  state.showEntryForm = true;
  state.formError = "";
  render();
  document.querySelector("#entry-name")?.focus();
}

function closeEntryForm() {
  if (!state.saving) {
    state.showEntryForm = false;
    state.editingEntryId = null;
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
        await invoke("update_entry", {
          entryId: state.editingEntryId,
          site: name,
          username,
          password,
          notes: url ? `URL: ${url}${notes ? `\n${notes}` : ""}` : notes,
          folderId: folderId || null,
        });
        state.showEntryForm = false;
        state.editingEntryId = null;
        state.saving = false;
        await saveVault(); // Save encrypted vault after update
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

function openPasswordGenerator() {
  state.showEntryForm = false;
  state.returnToEntryForm = true;
  if (state.showFirstEntryGuide) state.firstEntryGuideStep = 4;
  state.generatorType = "password";
  state.generatedValue = generateValue();
  state.view = "generator";
  render();
}

function useGeneratedPassword() {
  state.showEntryForm = true;
  state.returnToEntryForm = false;
  if (state.showFirstEntryGuide) state.firstEntryGuideStep = 5;
  state.view = "vault";
  render();
  const input = document.querySelector("#entry-password");
  if (input) {
    input.value = state.generatedValue;
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
    .querySelector("#continue-auth-selection")
    ?.addEventListener("click", async () => {
      if (state.authMethodSelected === "password") {
        state.showAuthMethodSelection = false;
        render();
      } else if (state.authMethodSelected === "image") {
        state.showGridSetup = true;
        state.changingAuthMethod = false;
        state.gridSetupPattern = [];
        state.imageGridPattern = [];
        state.imageGridBrushPath = [];
        state.imageGridCellValues = generateGridFragments();
        state.gridSetupError = "";
        state.imageAuthImage = "";
        imageAuthRenderSource = "";
        localStorage.removeItem("image_auth_image");
        render();
      }
    });
  document.querySelectorAll("[data-grid-cell]").forEach((cell) => {
    cell.addEventListener("click", () => {
      const cellIndex = Number(cell.dataset.gridCell);
      if (cell.classList.contains("selected")) {
        // Remove from pattern

        state.gridSetupPattern = state.gridSetupPattern.filter(
          (i) => i !== cellIndex,
        );
      } else {
        // Add to pattern

        state.gridSetupPattern.push(cellIndex);
      }
      render();
    });
  });
  document
    .querySelector("#save-grid-setup")
    ?.addEventListener("click", async () => {
      if (state.gridSetupPattern.length !== state.gridCellSize) {
        state.gridSetupError = `Has de seleccionar ${state.gridCellSize} cèl·lules.`;
        render();
        return;
      }
      state.showGridSetup = false;
      state.showAuthMethodSelection = false;
      try {
        await invoke("set_grid_auth", {
          pattern: state.gridSetupPattern,
        });
        state.masterPassword = "";
        showToast("Grid de seguretat configurat correctament.");
        render();
      } catch (error) {
        state.gridSetupError = String(error);
        render();
      }
    });
  document
    .querySelector("#cancel-grid-setup")
    ?.addEventListener("click", () => {
      state.showGridSetup = false;
      state.gridSetupError = "";
      render();
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
          document.querySelector("#image-upload-area").style.display = "none";
          document.querySelector("#image-auth-canvas-area").style.display = "";
          renderImageOnCanvas();
        };
        reader.readAsDataURL(file);
      }
    });

  if (state.showGridSetup && state.imageAuthImage) {
    const uploadArea = document.querySelector("#image-upload-area");
    const canvasArea = document.querySelector("#image-auth-canvas-area");
    if (uploadArea) uploadArea.style.display = "none";
    if (canvasArea) canvasArea.style.display = "";
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
      if (!state.imageAuthImage || state.imageGridCellValues.length !== 25) {
        state.gridSetupError = "Puja una imatge abans de desar la graella.";
        render();
        return;
      }
      if (state.imageGridPattern.length < 5) {
        state.gridSetupError = "Has de seleccionar almenys 5 punts.";
        render();
        return;
      }
      try {
        const masterPassword = state.imageGridPattern
          .map((cell) => state.imageGridCellValues[cell])
          .join("");
        if (state.changingAuthMethod) {
          const result = await invoke("change_vault_to_image_grid", {
            currentPassword: state.masterPassword,
            selectedCells: state.imageGridPattern,
            imageData: state.imageAuthImage,
            cellValues: state.imageGridCellValues,
          });
          state.entries = (result.entries || []).map((entry) => ({
            ...entry,
            folderId: entry.folder_id || entry.folderId || null,
            createdAt: entry.created_at || entry.createdAt,
            updatedAt: entry.updated_at || entry.updatedAt || null,
          }));
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
            cellValues: state.imageGridCellValues,
          });
          await invoke("init_empty_vault", { password: masterPassword });
        }
        localStorage.removeItem("image_auth_image");
        state.masterPassword = masterPassword;
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
      state.gridSetupPattern = [];
      state.imageGridPattern = [];
      state.imageAuthImage = "";
      state.imageGridCellValues = [];
      state.showChangeAuthModal = returningToChangeAuth;
      state.changingAuthMethod = false;
      imageAuthRenderSource = "";
      if (!returningToChangeAuth) {
        localStorage.removeItem("image_auth_image");
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
      state.imageGridCellValues = [];
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
      state.gridUnlockPattern = [];
      state.imageGridPattern = [];
      state.imageUnlockBrushPath = [];
      render();
    });

  document
    .querySelector("#cancel-image-auth-unlock-bottom")
    ?.addEventListener("click", () => {
      state.showGridUnlock = false;
      state.gridUnlockError = "";
      state.gridUnlockPattern = [];
      state.imageGridPattern = [];
      state.imageUnlockBrushPath = [];
      render();
    });

  const unlockCanvas = document.querySelector("#image-auth-unlock-canvas");
  if (unlockCanvas) {
    const persistedImage =
      state.imageAuthImage || localStorage.getItem("image_auth_image");
    console.log(
      "Unlock canvas found, persisted image:",
      persistedImage ? "yes" : "no",
    );
    if (persistedImage) {
      const img = new Image();
      img.onload = () => {
        console.log("Image loaded, drawing to canvas");
        drawImageAuthBackground(unlockCanvas, img);
        if (state.imageGridCellValues.length === 25) {
          drawImageAuthGrid(
            unlockCanvas,
            state.imageGridPattern,
            state.imageUnlockBrushPath,
          );
        } else {
          drawLegacyImagePoints(unlockCanvas, state.gridUnlockPattern);
        }
      };
      img.onerror = () => {
        console.log("Error loading image");
      };
      img.src = persistedImage;
    }
  }

  document
    .querySelector("#image-auth-unlock-canvas")
    ?.addEventListener("click", (event) => {
      if (state.imageGridCellValues.length === 25) return;
      const canvas = event.target;
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      state.gridUnlockPattern.push({ x, y });
      drawLegacyImagePoints(canvas, state.gridUnlockPattern);
      updateImageAuthOrder(
        "image-auth-unlock-count",
        "image-auth-unlock-order",
        state.gridUnlockPattern,
      );
    });

  const imageUnlockCanvas = document.querySelector("#image-auth-unlock-canvas");
  imageUnlockCanvas?.addEventListener("pointerdown", (event) => {
    if (state.imageGridCellValues.length !== 25) return;
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
    if (
      state.imageGridCellValues.length === 25 &&
      state.imageGridPointerActive
    ) {
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
      state.gridUnlockPattern.pop();
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
      state.gridUnlockPattern = [];
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
      const selectedCells =
        state.imageGridCellValues.length === 25
          ? state.imageGridPattern
          : state.gridUnlockPattern;
      if (selectedCells.length === 0) {
        state.gridUnlockError = "Selecciona els punts del teu patró.";
        render();
        return;
      }
      state.loading = true;
      render();
      try {
        const pattern =
          state.imageGridCellValues.length === 25
            ? state.imageGridPattern.slice()
            : encodeImageAuthPattern(state.gridUnlockPattern);
        const masterPassword =
          state.imageGridCellValues.length === 25
            ? pattern.map((cell) => state.imageGridCellValues[cell]).join("")
            : (state.legacyImageAuthPattern.length
                ? state.legacyImageAuthPattern
                : pattern
              )
                .map((byte) => String(byte))
                .join("-");
        const result = await invoke("unlock_vault_grid", {
          pattern,
        });
        state.masterPassword = masterPassword;
        state.entries = (result.entries || []).map((entry) => ({
          ...entry,
          folderId: entry.folder_id || null,
          createdAt: entry.created_at || entry.createdAt,
          updatedAt: entry.updated_at || entry.updatedAt || null,
        }));
        state.history = result.history || [];
        state.trash = result.trash || [];
        state.folders = result.folders || [];
        state.activeFolderId = "";
        state.locked = false;
        state.showGridUnlock = false;
        state.gridUnlockPattern = [];
        state.imageGridPattern = [];
        resetAutoLock();
      } catch (error) {
        state.gridUnlockError = String(error);
        state.gridUnlockPattern = [];
        state.imageGridPattern = [];
      } finally {
        state.loading = false;
        render();
      }
    });

  function encodeImageAuthPattern(points) {
    return points
      .map((p) => {
        const xByte = Math.floor(p.x);
        const yByte = Math.floor(p.y);
        return [xByte, yByte];
      })
      .flat();
  }

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
    const source =
      state.imageAuthImage || localStorage.getItem("image_auth_image") || "";
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

  function drawLegacyImagePoints(canvas, points) {
    withImageAuthBackground(canvas, (ctx) => {
      const displayScale = canvasDisplayScale(canvas);
      points.forEach((point, index) => {
        const x = (point.x * canvas.width) / 100;
        const y = (point.y * canvas.height) / 100;
        ctx.beginPath();
        ctx.arc(x, y, 19 * displayScale, 0, 2 * Math.PI);
        ctx.fillStyle = "#2471d1";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3 * displayScale;
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.font = `700 ${15 * displayScale}px 'DM Sans', sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(index + 1), x, y);
      });
    });
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
    if (state.imageGridCellValues.length !== 25) return;
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
      selectedCells.length >= 5 &&
      state.gridSetupError.startsWith("Has de seleccionar almenys 5")
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
    if (state.imageGridCellValues.length === 25) {
      drawImageAuthGrid(canvas, selectedCells, brushPath);
      updateImageAuthOrder(countId, orderId, selectedCells);
    } else {
      drawLegacyImagePoints(canvas, state.gridUnlockPattern);
      document.getElementById(countId).textContent =
        state.gridUnlockPattern.length;
      document.getElementById(orderId).textContent =
        state.gridUnlockPattern
          .map((_, index) => String(index + 1))
          .join(" → ") || "cap";
    }
  }

  function generateGridFragments() {
    const characterSets = [
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      "abcdefghijklmnopqrstuvwxyz",
      "0123456789",
      "!@#$%^&*()-_=+[]{}",
    ];
    const fragments = [];
    const uniqueFragments = new Set();
    while (fragments.length < 25) {
      const characters = characterSets.map(
        (set) => set[secureRandomIndex(set.length)],
      );
      for (let index = characters.length - 1; index > 0; index -= 1) {
        const swapIndex = secureRandomIndex(index + 1);
        [characters[index], characters[swapIndex]] = [
          characters[swapIndex],
          characters[index],
        ];
      }
      const fragment = characters.join("");
      if (uniqueFragments.has(fragment)) continue;
      uniqueFragments.add(fragment);
      fragments.push(fragment);
    }
    return fragments;
  }

  function secureRandomIndex(limit) {
    const range = 0x100000000;
    const cutoff = range - (range % limit);
    const value = new Uint32Array(1);
    do {
      crypto.getRandomValues(value);
    } while (value[0] >= cutoff);
    return value[0] % limit;
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
        state.gridSetupPattern = [];
        state.imageGridPattern = [];
        state.imageGridBrushPath = [];
        state.imageGridCellValues = generateGridFragments();
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
          currentPassword: state.masterPassword,
          newPassword,
        });
        state.masterPassword = newPassword;
        state.showChangeAuthModal = false;
        state.changeAuthError = "";
        state.changeAuthSelected = "password";
        localStorage.removeItem("image_auth_image");
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
      state.showCloudLogin = true;
      render();
    }),
  );
  document
    .querySelector("#cloud-login-form")
    ?.addEventListener("submit", cloudAuthSubmit);
  document.querySelectorAll("#cancel-cloud-login").forEach((button) =>
    button.addEventListener("click", () => {
      state.showCloudLogin = false;
      state.cloudError = "";
      render();
    }),
  );
  document
    .querySelector("#download-cloud-vault")
    ?.addEventListener("click", downloadCloudVault);
  document
    .querySelector("#register-cloud-vault")
    ?.addEventListener("click", registerCloudVault);
  document
    .querySelector("#reset-vault")
    ?.addEventListener("click", resetLocalVault);

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
    state.view = "vault";
    render();
  });
  document.querySelector("#nav-settings")?.addEventListener("click", () => {
    state.view = "settings";
    render();
  });
  document.querySelector("#nav-generator")?.addEventListener("click", () => {
    state.generatorType = "password";
    state.generatedValue = state.generatedValue || generateValue();
    state.view = "generator";
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
      document.documentElement.style.setProperty("--app-font-size", `${val}px`);
      document.documentElement.style.fontSize = `${val}px`;
      const out = document.querySelector("#font-size-value");
      if (out) out.textContent = `${val} px`;
      localStorage.setItem(
        "caixa-forta-settings",
        JSON.stringify(state.settings),
      );
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
      showToast("Caixa forta actualitzada.");
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
document
  .querySelector("#entry-password")
  ?.addEventListener("input", (event) => {
    updateEntryStrength(event.target.value);
  });

async function reloadVaultEntries() {
  if (state.locked) return;
  try {
    const vault = await invoke("get_vault_entries");
    if (vault && vault.entries) {
      state.entries = (vault.entries || []).map((entry) => ({
        id: entry.id,
        site: entry.site,
        username: entry.username,
        password: entry.password,
        notes: entry.notes || "",
        folderId: entry.folder_id || entry.folderId || null,
        createdAt: entry.created_at || entry.createdAt,
        updatedAt: entry.updated_at || entry.updatedAt || null,
        deletedAt: entry.deleted_at || entry.deletedAt || null,
      }));
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
  showToast("Caixa forta sincronitzada amb l'extensió.");
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

/**
 * Caixa Forta - Gestor de contrasenyes local segur
 * Frontend principal amb arquitectura modular i neta.
 */

import { invoke } from "@tauri-apps/api/core";
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

/* ==========================================================================
   Icones de l'aplicació
   ========================================================================== */

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
  Palette,
  Type,
  Moon,
  Sun,
  Monitor,
  RotateCcw,
  Pencil,
  Cloud,
};

/* ==========================================================================
   Estat global i configuració per defecte
   ========================================================================== */

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
  masterPassword: "",
  loading: false,
  entries: [],
  folders: [],
  activeFolderId: "",
  history: [],
  trash: [],
  query: "",
  error: "",
  toast: "",
  viewingEntryId: null,
  editingEntryId: null,
  showEntryForm: false,
  showTrashModal: false,
  showChangeMasterModal: false,
  showFolderModal: false,
  editingFolderId: null,
  returnToEntryForm: false,
  settings: savedSettings,
  cloudConfig: { railwayUrl: "", vaultId: "", token: "", ...savedCloudConfig },
  showCloudLogin: false,
  cloudLoading: false,
  cloudError: "",
  formError: "",
  masterChangeError: "",
  folderFormError: "",
  saving: false,
  changingMaster: false,
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
};

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
  if (state.locked || state.settings.autoLock === "never") return;
  const minutes = Number(state.settings.autoLock);
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  autoLockTimer = setTimeout(() => lockVault(), minutes * 60_000);
}

async function lockVault() {
  if (state.locked) return;
  try {
    await invoke("lock_vault");
  } catch (error) {
    showToast(`No s'ha pogut bloquejar la caixa forta: ${error}`);
    return;
  }
  state.locked = true;
  state.masterPassword = "";
  state.entries = [];
  state.history = [];
  state.trash = [];
  state.folders = [];
  state.generatedValue = "";
  state.query = "";
  state.activeFolderId = "";
  state.viewingEntryId = null;
  state.editingEntryId = null;
  state.showEntryForm = false;
  state.showFolderModal = false;
  state.showChangeMasterModal = false;
  render();
}

async function copySensitiveText(value, message) {
  await navigator.clipboard.writeText(value);
  clearTimeout(clipboardClearTimer);
  clipboardClearTimer = setTimeout(async () => {
    try {
      if ((await navigator.clipboard.readText()) === value) {
        await navigator.clipboard.writeText("");
      }
    } catch {
      // Alguns entorns no permeten llegir el porta-retalls sense permís explícit.
    }
  }, 30_000);
  showToast(message);
}

// Lock screen check
async function checkVaultLocked() {
  try {
    const info = await invoke("get_vault_info");
    if (info.exists) {
      // Try to unlock - if it fails with wrong password, user will be shown error
      try {
        await invoke("unlock_vault", { masterPassword: "" });
      } catch (error) {
        // Vault exists but is locked (wrong password or just locked)
        return true;
      }
    }
  } catch (error) {
    // Vault doesn't exist yet
  }
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
    confirmPassword: document.querySelector("#auth-confirm-password")?.value || "",
    privacyAccepted: document.querySelector("#privacy-accepted")?.checked || false,
  };
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
  
  // If user is not authenticated and we're on official cloud, show unlock dialog
  if (config.provider === "official" && !state.cloudConfig.authUser) {
    if (!state.locked) {
      showToast("L'usuari no està autenticat. Autentica primer.");
      return;
    }
    // Show unlock dialog
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
    state.cloudError = "La contrasenya mestra ha de tenir almenys 16 caràcters.";
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
    // For official cloud, authenticate user first
    if (config.provider === "official") {
      await invoke("auth_official_cloud", {
        username: config.username,
        password: masterPassword,
      });
      // Update config with auth user
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
    showToast(config.provider === "official" ? "Authenticació completada. Obre la caixa forta." : "Vault creat al núvol.");
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
    state.cloudError = "La contrasenya mestra ha de tenir almenys 16 caràcters.";
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
    // For official cloud, authenticate user
    if (config.provider === "official") {
      await invoke("auth_official_cloud", {
        username: config.username,
        password: config.password,
      });
      // Update config with auth user
      state.cloudConfig.authUser = config.username;
      // Update UI to show locked state and allow opening vault
      state.locked = false;
    } else {
      // For custom cloud, use existing flow
      await invoke("set_railway_sync_config", rustCloudConfig(config));
      state.cloudConfig = config;
      localStorage.setItem("caixa-forta-cloud", JSON.stringify(config));
    }
    
    state.showCloudLogin = false;
    showToast(config.provider === "official" ? "Autenticació completada. Obre la caixa forta." : "Connexió amb Railway completada.");
  } catch (error) {
    state.cloudError = String(error);
  } finally {
    state.cloudLoading = false;
    render();
  }
}

async function downloadCloudVault() {
  if (prompt('Escriu "ELIMINAR" per confirmar:') !== "ELIMINAR") return;
  try {
    await invoke("reset_vault");
    localStorage.removeItem("caixa-forta-master-password");
    state.entries = [];
    state.folders = [];
    state.trash = [];
    state.history = [];
    state.locked = true;
    state.view = "vault";
    showToast("Dades locals eliminades.");
  } catch (error) {
    state.error = String(error);
  }
  state.masterPassword = "";
  render();
}

/* ==========================================================================
   Renderització i sincronització de configuració
   ========================================================================== */

function render() {
  const appContainer = document.querySelector("#app");
  if (!appContainer) return;

  if (state.locked) {
    appContainer.innerHTML = lockScreen();
  } else if (state.view === "generator") {
    appContainer.innerHTML = generatorScreen();
  } else if (state.view === "settings") {
    appContainer.innerHTML = settingsScreen();
  } else {
    appContainer.innerHTML = vaultScreen();
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

/* ==========================================================================
   Components de navegació i estructurals
   ========================================================================== */

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
        <button class="icon-btn" title="Copiar la contrasenya" data-copy="${entry.id}">
          ${icon("Copy")}
        </button>
        <button class="icon-btn more" title="Detalls, editar o eliminar" data-view-action="${entry.id}">
          ${icon("MoreHorizontal")}
        </button>
      </div>
    </article>
  `;
}

/* ==========================================================================
   Pantalles principals (Screens)
   ========================================================================== */

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
              placeholder="Crea una contrasenya de 12 caràcters o més"
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
    ${state.showCloudLogin ? cloudLoginModal() : ""}
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
          <button class="lock-button" id="lock-vault" title="Bloquejar la caixa forta">
            ${icon("LockKeyhole", 17)}
          </button>
        </header>

        <div class="toolbar">
          <label class="search">
            ${icon("Search", 18)}
            <input
              id="search"
              placeholder="Cerca per lloc o usuari"
              value="${escapeHtml(state.query)}"
            />
          </label>
          <button class="primary" id="new-entry">
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

        ${bottomNavComponent("vault")}
      </section>
    </main>

    ${state.viewingEntryId ? entryDetailsModal() : ""}
    ${state.showEntryForm ? entryFormModal() : ""}
    ${state.showTrashModal ? trashModal() : ""}
    ${state.showChangeMasterModal ? changeMasterPasswordModal() : ""}
    ${state.showFolderModal ? folderModal() : ""}
    ${state.toast ? `<div class="toast show">${escapeHtml(state.toast)}</div>` : ""}
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
          <output>${escapeHtml(state.generatedValue || generateValue())}</output>
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
            <button class="use-generated primary" id="use-generated">
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
          <button class="setting-action" id="change-master">
            ${icon("LockKeyhole", 18)} Canvi de contrasenya mestra
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
    ${state.showChangeMasterModal ? changeMasterPasswordModal() : ""}
    ${state.showCloudLogin ? cloudLoginModal() : ""}
    ${state.toast ? `<div class="toast show">${escapeHtml(state.toast)}</div>` : ""}
  `;
}

/* ==========================================================================
   Modals i diàlegs
   ========================================================================== */

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

  return `
    <div class="modal-backdrop">
      <section class="entry-modal" role="dialog" aria-modal="true" aria-labelledby="entry-title">
        <header class="modal-header">
          <button class="modal-icon" id="cancel-entry" title="Tornar">
            ${icon("X", 20)}
          </button>
          <h2 id="entry-title">${isEditing ? "Editar accés" : "Nou accés"}</h2>
          <button class="modal-icon" id="save-entry-top" title="Desar">
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
                class="form-input"
                id="entry-name"
                name="name"
                required
                autofocus
                placeholder="Ex. YouTube"
                value="${escapeHtml(entry.site || "")}"
              />

              <label class="form-label" for="entry-folder">Carpeta</label>
              <select class="form-input" id="entry-folder" name="folder">
                <option value="">Sense carpeta</option>
                ${state.folders.map((folder) => `<option value="${escapeHtml(folder.id)}" ${entry.folderId === folder.id ? "selected" : ""}>${escapeHtml(folder.name)}</option>`).join("")}
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
                value="${escapeHtml(entry.username || "")}"
              />

              <label class="form-label" for="entry-password">Contrasenya <b>*</b></label>
              <div class="input-with-actions">
                <input
                  class="form-input"
                  id="entry-password"
                  name="password"
                  type="text"
                  required
                  autocomplete="new-password"
                  value="${escapeHtml(entry.password || "")}"
                />
                <button type="button" class="field-action" id="entry-password-reveal" title="Ocultar contrasenya">
                  ${icon("Eye", 18)}
                </button>
                <button type="button" class="field-action" id="generate-password" title="Generar contrasenya">
                  ${icon("RefreshCw", 18)}
                </button>
              </div>
              <small class="helper">
                La contrasenya és visible. Utilitza el generador per crear-ne una de forta i única.
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
                value="${escapeHtml(url || "")}"
              />

              <h3>Opcions addicionals</h3>
              <label class="form-label" for="entry-notes">Notes</label>
              <textarea class="form-input notes-input" id="entry-notes" name="notes">${escapeHtml(cleanNotes || "")}</textarea>
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

function changeMasterPasswordModal() {
  return `
    <div class="modal-backdrop">
      <section class="entry-modal" role="dialog" aria-modal="true" aria-labelledby="change-master-title">
        <header class="modal-header">
          <button class="modal-icon" id="cancel-change-master" title="Tancar">
            ${icon("X", 20)}
          </button>
          <h2 id="change-master-title">Canvia la contrasenya mestra</h2>
        </header>

        <form id="change-master-form">
          <div class="modal-scroll">
            <section class="form-section master-password-section">
              <p class="helper master-password-help">La caixa forta es tornarà a xifrar amb la nova contrasenya. No podràs recuperar-la si l'oblides.</p>

              <label class="form-label" for="current-master-password">Contrasenya mestra actual</label>
              <input class="form-input" id="current-master-password" name="currentPassword" type="password" autocomplete="current-password" required autofocus />

              <label class="form-label" for="new-master-password">Contrasenya mestra nova</label>
              <input class="form-input" id="new-master-password" name="newPassword" type="password" autocomplete="new-password" minlength="12" required aria-describedby="new-master-password-help" />
              <small class="helper" id="new-master-password-help">Ha de tenir com a mínim 12 caràcters.</small>

              <label class="form-label" for="confirm-master-password">Confirma la contrasenya nova</label>
              <input class="form-input" id="confirm-master-password" name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required />
            </section>
            ${state.masterChangeError ? `<p class="error form-error">${escapeHtml(state.masterChangeError)}</p>` : ""}
          </div>

          <footer class="modal-footer">
            <button type="button" class="secondary" id="cancel-change-master-bottom">Cancel·la</button>
            <button type="submit" class="primary" ${state.changingMaster ? "disabled" : ""}>
              ${state.changingMaster ? "Canviant..." : "Canvia la contrasenya"}
            </button>
          </footer>
        </form>
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
                <select class="form-input" id="cloud-provider" name="provider" ${isOfficial ? 'disabled style="opacity: 0.5"' : ''}>
                  <option value="official" ${isOfficial ? 'selected' : ''}>Núvol oficial (recomanat)</option>
                  <option value="custom" ${!isOfficial ? 'selected' : ''}>Personalitzat (domini propi)</option>
                </select>
                ${!isOfficial ? '<span class="provider-hint">Introdueix el teu propi domini Railway</span>' : ''}
              </div>
              ${!isOfficial ? `<div class="provider-hint">El núvol oficial no requereix configuració extra</div>` : ''}
            </div>
            
            <!-- Username/Email -->
            <div class="form-section auth-section">
              <label class="form-label" for="auth-username">Usuari o correu electrònic:</label>
              <input class="form-input" id="auth-username" name="username" type="text" required minlength="3" placeholder="E. g., joan.perez" ${isOfficial && !config.authUser ? 'required' : ''} />
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
            <button type="submit" class="primary" ${state.cloudLoading ? "disabled" : ""}>${state.cloudLoading ? "Autenticant..." : (isOfficial ? "Autentica" : "Configura núvol")}</button>
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

/* ==========================================================================
   Opcions i algorismes del generador
   ========================================================================== */

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
  return `
    <label>
      Nombre de paraules
      <input id="generator-words" type="number" min="3" max="20" value="${state.generatorOptions.words}" />
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
    const words = generatorWords();
    const result = Array.from({ length: state.generatorOptions.words }, () =>
      randomItem(words),
    );
    const value =
      state.generatorOptions.uppercaseWords === false
        ? result.map(formatGeneratorWord).join(state.generatorOptions.separator)
        : result
            .map((word) => {
              const formatted = formatGeneratorWord(word);
              return formatted.charAt(0).toUpperCase() + formatted.slice(1);
            })
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
      20,
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
  await copySensitiveText(value, "Generació copiada.");
  addHistory();
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

/* ==========================================================================
   Operacions de dades (CRUD Vault, Import/Export, Lock/Unlock)
   ========================================================================== */

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
    state.entries = result.entries || [];
    state.history = result.history || [];
    state.trash = result.trash || [];
    state.folders = result.folders || [];
    state.activeFolderId = "";
    state.locked = false;
    resetAutoLock();
    if (result.isNew) {
      // Create initial folder structure
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
      await saveVault(masterPassword, true); // Enable sync for new vault
    }
  } catch (error) {
    state.error = String(error);
  } finally {
    state.loading = false;
    render();
  }
}

async function saveVault(masterPassword = null, syncToRailway = false) {
  // Convert entries to the expected format
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

  // Get master password from secure storage if not provided
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
    // Store password for next save (auto-save)
    if (masterPassword === null) {
      try {
        localStorage.setItem("caixa-forta-master-password", password);
      } catch (e) {
        // Storage might be disabled
      }
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

async function changeMasterPassword(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const currentPassword = String(form.get("currentPassword") || "");
  const newPassword = String(form.get("newPassword") || "");
  const confirmPassword = String(form.get("confirmPassword") || "");

  if (newPassword.length < 12) {
    state.masterChangeError =
      "La contrasenya nova ha de tenir com a mínim 12 caràcters.";
    render();
    return;
  }
  if (newPassword !== confirmPassword) {
    state.masterChangeError = "Les contrasenyes noves no coincideixen.";
    render();
    return;
  }

  state.masterChangeError = "";
  state.changingMaster = true;
  render();
  try {
    // Use the Rust implementation that handles re-encryption
    await invoke("change_master_password", {
      currentPassword,
      newPassword,
      entries: state.entries,
      history: state.history,
      trash: state.trash,
      folders: state.folders,
    });
    state.masterPassword = newPassword;
    // Clear stored password for security
    try {
      localStorage.removeItem("caixa-forta-master-password");
    } catch (e) {
      // Storage might be disabled
    }
    state.showChangeMasterModal = false;
    showToast("Contrasenya mestra canviada correctament.");
  } catch (error) {
    state.masterChangeError = String(error);
  } finally {
    state.changingMaster = false;
    render();
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
  state.generatorType = "password";
  state.generatedValue = generateValue();
  state.view = "generator";
  render();
}

function useGeneratedPassword() {
  state.showEntryForm = true;
  state.returnToEntryForm = false;
  state.view = "vault";
  render();
  const input = document.querySelector("#entry-password");
  if (input) {
    input.value = state.generatedValue;
    input.focus();
  }
}

/* ==========================================================================
   Assignació d'esdeveniments (Event Listeners)
   ========================================================================== */

function bindEvents() {
  // Desbloqueig
  document.querySelector("#unlock-form")?.addEventListener("submit", unlock);
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

  // Cercador
  document.querySelector("#search")?.addEventListener("input", (event) => {
    state.query = event.target.value.toLowerCase();
    render();
    const search = document.querySelector("#search");
    search?.focus();
    search?.setSelectionRange(search.value.length, search.value.length);
  });

  // Carpetes
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

  // Navegació de vistes
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

  // Configuració d'aparença i bloqueig
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

  document.querySelector("#change-master")?.addEventListener("click", () => {
    state.masterChangeError = "";
    state.showChangeMasterModal = true;
    render();
  });

  document
    .querySelector("#change-master-form")
    ?.addEventListener("submit", changeMasterPassword);
  document
    .querySelectorAll("#cancel-change-master, #cancel-change-master-bottom")
    .forEach((button) =>
      button.addEventListener("click", () => {
        state.showChangeMasterModal = false;
        state.masterChangeError = "";
        render();
      }),
    );

  // Paperera
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

  // Importació i exportació
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

  // Formulari i targetes d'entrades
  document
    .querySelectorAll("#new-entry, #empty-new, #nav-new")
    .forEach((button) => button.addEventListener("click", openNewEntry));

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

  // Modal de detalls d'accés
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
  document.querySelector("#delete-entry-btn")?.addEventListener("click", async () => {
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
      if (text) {
        navigator.clipboard
          .writeText(text)
          .then(() => showToast("Copiat al porta-retalls."));
      }
    }),
  );

  // Formulari d'edició / creació
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
      copyEntry(button.dataset.copy);
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

  // Bloqueig
  document.querySelector("#lock-vault")?.addEventListener("click", async () => {
    await lockVault();
  });
}

// Observador del tema del sistema operatiu per al mode 'auto'
try {
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if ((state.settings.theme || "auto") === "auto") {
        applySettings();
      }
    });
} catch {
  // Ignorat en entorns webview antics
}

// Inicialització de la interfície
["pointerdown", "keydown", "touchstart"].forEach((eventName) =>
  window.addEventListener(eventName, resetAutoLock, { passive: true }),
);

render();

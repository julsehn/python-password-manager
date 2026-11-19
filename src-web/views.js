import { icon } from "./constants.js";
import {
  bottomNavComponent,
  entryCard,
  sidebarComponent,
} from "./components.js";
import { escapeHtml } from "./utils.js";
import {
  passwordOptions,
  passphraseOptions,
  usernameOptions,
} from "./generator.js";
import { historyItem } from "./modals.js";
import { createDialogViews } from "./dialogs.js";

export function createViews(state) {
  const {
    downloadPasswordModal,
    welcomeModal,
    authMethodSelectionModal,
    imageAuthSetupModal,
    imageAuthUnlockModal,
    changeAuthMethodModal,
    firstEntryGuideModal,
    entryDetailsModal,
    entryFormModal,
    trashModal,
    resetConfirmModal,
    cloudLoginModal,
    folderModal,
  } = createDialogViews(state);
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
              : `<p class="palette-empty">${query ? "Cap accés coincideix amb la cerca." : "La SherLock no conté accessos."}</p>`
          }
        </div>
        <footer class="palette-footer"><span>${results.length} ${results.length === 1 ? "accés" : "accessos"}</span><span><kbd>↑</kbd><kbd>↓</kbd> navegar</span><span><kbd>Enter</kbd> copiar</span></footer>
      </section>
    </div>
  `;
  }

  function lockScreen() {
    return `
    <main class="lock-shell">
      <div class="lock-card">
        <div class="brand-mark large"><img class="brand-icon" src="/brand/SherLock-brand.png" alt="" /></div>
        <p class="eyebrow">SherLock LOCAL</p>
        <h1>Un espai segur per als teus accessos</h1>
        <p class="lock-copy">
          Si és el primer ús, crea ara una contrasenya mestra nova. La necessitaràs cada vegada que obris la SherLock.
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
            ${state.loading ? "Desbloquejant..." : "Crear o desbloquejar la SherLock"}
          </button>
        </form>
        <button class="secondary full" id="open-cloud-login" data-context="download">
          ${icon("Cloud", 17)} Restaurar des del núvol (Railway)
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
    ${state.showDownloadPassword ? downloadPasswordModal() : ""}
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
      ${sidebarComponent(state)}
      <section class="workspace">
        <header class="topbar">
          <div>
            <p class="eyebrow">EL TEU SherLock</p>
            <h1>Les teves contrasenyes</h1>
            <p class="subtitle">Tot el que necessites, protegit i a mà.</p>
          </div>
          <div class="header-actions">
            <button class="lock-button" id="refresh-vault" title="Actualitzar accessos">
              ${icon("RotateCw", 17)}
            </button>
            <button class="lock-button" id="lock-vault" title="Bloquejar la SherLock">
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
                <h2>${state.entries.length ? "No s'ha trobat cap accés" : "La teva SherLock està buida"}</h2>
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
          <p class="subtitle">Crea credencials úniques i desa l'historial dins de la SherLock.</p>
        </div>
        <button class="lock-button" id="lock-vault" title="Bloquejar la SherLock">
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
          ${
            isPassword
              ? passwordOptions(state.generatorOptions)
              : isPassphrase
                ? passphraseOptions(state.generatorOptions, currentLang)
                : usernameOptions(state.generatorOptions)
          }
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
          <p class="subtitle">Adapta SherLock a la teva manera de treballar.</p>
        </div>
        <button class="lock-button" id="lock-vault" title="Bloquejar la SherLock">
          ${icon("LockKeyhole", 17)}
        </button>
      </header>

      <div class="settings-content">
        <section class="settings-section">
          <div class="settings-section-title">
            ${icon("ShieldCheck", 19)}
            <h2>Seguretat de la SherLock</h2>
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
            ${icon("Globe", 19)}
            <h2>Browsers vinculats</h2>
          </div>
          <p class="helper">
            Cada navegador necessita una vinculació puntual. L'extensió signa els reptes amb una clau pròpia; el codi només és vàlid durant dos minuts i s'utilitza una sola vegada.
          </p>
          <button class="setting-action" id="generate-browser-pairing-code">
            ${icon("KeyRound", 18)} Generar codi per vincular un navegador
          </button>
          ${
            state.browserPairingCode
              ? `
            <div class="cloud-status-card browser-pairing-code" role="status">
              <strong class="pairing-code-value">${escapeHtml(state.browserPairingCode)}</strong>
              <small>
                Introdueix aquest codi a l'extensió.
                Temps restant: <span data-pairing-remaining>${pairingSecondsRemaining(state.browserPairingExpiresAt)}</span> s.
              </small>
            </div>
          `
              : ""
          }
          <div class="paired-browser-list">
            ${
              state.pairedBrowsers.length
                ? state.pairedBrowsers
                    .map(
                      (client) => `
              <div class="setting-row paired-browser-row">
                <span>
                  <strong>${escapeHtml(client.label || "Navegador")}</strong>
                  <small>${escapeHtml(client.browser || "Browser")} · Vinculat ${escapeHtml(client.created_at || "")}</small>
                </span>
                <button type="button" class="secondary danger" data-revoke-paired-browser="${escapeHtml(client.id)}">Revocar</button>
              </div>
            `,
                    )
                    .join("")
                : `<p class="helper">Encara no hi ha cap navegador vinculat.</p>`
            }
          </div>
        </section>

        <section class="settings-section">
          <div class="settings-section-title">
            ${icon("Vault", 19)}
            <h2>Opcions de la SherLock</h2>
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
            <h2>Sincronització amb Railway</h2>
          </div>
          ${
            state.cloudConfig.authUser
              ? `
            <div class="cloud-status-card">
              <div class="cloud-status-header">
                <span class="cloud-badge">
                  <span class="cloud-badge-dot"></span>
                  Sessió activa a Railway com a <strong>${escapeHtml(state.cloudConfig.authUser)}</strong>
                </span>
                <span class="cloud-status-provider">
                  ${state.cloudConfig.railwayUrl ? "Servidor propi" : "Núvol oficial"}
                </span>
              </div>
              <p class="helper helper-top">
                Còpia de seguretat xifrada al núvol oficial de Railway. El servidor només guarda les teves credencials i la SherLock xifrada (AES-256-GCM).
              </p>
              <div class="cloud-actions-row">
                <button type="button" class="primary" id="btn-cloud-sync-now" ${state.cloudLoading ? "disabled" : ""}>
                  ${icon("RefreshCw", 16)} Sincronitzar ara
                </button>
                <button type="button" class="secondary" id="btn-cloud-download-now" ${state.cloudLoading ? "disabled" : ""}>
                  ${icon("DownloadCloud", 16)} Descarregar del núvol
                </button>
                <button type="button" class="secondary danger" id="btn-cloud-logout">
                  ${icon("LogOut", 16)} Tancar sessió
                </button>
              </div>
            </div>
          `
              : `
            <p class="helper">Connecta amb el núvol oficial de Railway per mantenir una còpia xifrada de la teva SherLock i sincronitzar-la entre dispositius.</p>
            <button class="setting-action" id="open-cloud-login" data-context="settings">
              ${icon("Cloud", 18)} Iniciar sessió o crear compte a Railway
            </button>
          `
          }
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

  return {
    commandPalette,
    generatorScreen,
    lockScreen,
    settingsScreen,
    vaultScreen,
  };
}

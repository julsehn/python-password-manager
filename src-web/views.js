import { icon } from "./constants.js";
import {
  bottomNavComponent,
  entryCard,
  sidebarComponent,
} from "./components.js";
import {
  escapeHtml,
  formatRelativeTime,
  pairingSecondsRemaining,
} from "./utils.js";
import {
  generateValue,
  passwordOptions,
  passwordRequirementsMarkup,
  passwordStrengthMarkup,
  passphraseOptions,
  usernameOptions,
} from "./generator.js";
import { historyItem } from "./modals.js";
import { createDialogViews } from "./dialogs.js";

export function createViews(state) {
  const {
    downloadPasswordModal,
    privacyPolicyModal,
    changeAuthMethodModal,
    firstEntryGuideModal,
    entryDetailsModal,
    entryFormModal,
    trashModal,
    resetConfirmModal,
    cloudLoginModal,
    folderModal,
    appDialogModal,
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
    const isNewUser = state.vaultExists === false;

    return `
    <main class="lock-shell">
      <div class="lock-card ${isNewUser ? "lock-card-setup" : ""}">
        <div class="brand-mark large"><img class="brand-icon" src="/brand/SherLock-brand.png" alt="" /></div>
        <p class="eyebrow">SherLock LOCAL</p>
        <h1>${isNewUser ? "Benvingut a SherLock" : "Un espai segur per als teus accessos"}</h1>
        <p class="lock-copy">
          ${
            isNewUser
              ? "Crea ara la teva contrasenya mestra. La necessitaràs cada vegada que obris la SherLock i no la podem recuperar."
              : "Introdueix la teva contrasenya mestra per desbloquejar la SherLock."
          }
        </p>
        <form id="unlock-form" novalidate>
          <label class="field-label" for="master-password">Contrasenya mestra</label>
          <div class="password-field">
            ${icon("LockKeyhole", 17)}
            <input
              id="master-password"
              type="password"
              autocomplete="${isNewUser ? "new-password" : "current-password"}"
              placeholder="${isNewUser ? "Mínim 12 caràcters" : "La teva contrasenya mestra"}"
              required
            />
            <button type="button" class="reveal" id="reveal-password" title="Mostrar contrasenya" aria-label="Mostrar contrasenya" aria-pressed="false">
              <span class="eye-open">${icon("Eye", 17)}</span>
              <span class="eye-off">${icon("EyeOff", 17)}</span>
            </button>
          </div>
          ${
            isNewUser
              ? `
            <label class="field-label field-label-spaced" for="master-password-confirm">Repeteix la contrasenya mestra</label>
            <div class="password-field">
              ${icon("LockKeyhole", 17)}
              <input
                id="master-password-confirm"
                type="password"
                autocomplete="new-password"
                placeholder="Torna-la a escriure"
                required
              />
              <button type="button" class="reveal" id="reveal-password-confirm" title="Mostrar contrasenya" aria-label="Mostrar contrasenya" aria-pressed="false">
                <span class="eye-open">${icon("Eye", 17)}</span>
                <span class="eye-off">${icon("EyeOff", 17)}</span>
              </button>
            </div>
            <div class="password-setup-feedback" id="master-password-feedback">
              ${passwordStrengthMarkup("")}
              ${passwordRequirementsMarkup("")}
              <p class="password-match" data-password-match hidden aria-live="polite"></p>
            </div>
          `
              : ""
          }
          <p class="error" id="unlock-error" ${state.error ? "" : "hidden"}>${escapeHtml(state.error)}</p>
          <button class="primary full" type="submit" ${state.loading ? "disabled" : ""}>
            ${
              state.loading
                ? isNewUser
                  ? "Creant la SherLock..."
                  : "Desbloquejant..."
                : isNewUser
                  ? "Crear la meva SherLock"
                  : "Desbloqueja la SherLock"
            }
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
    ${state.showSetupPreferences ? setupPreferencesModal() : ""}
    ${state.showCloudLogin ? cloudLoginModal() : ""}
    ${state.showPrivacyPolicy ? privacyPolicyModal() : ""}
    ${state.appDialog ? appDialogModal() : ""}
    ${state.showDownloadPassword ? downloadPasswordModal() : ""}
  `;
  }

  function setupPreferencesModal() {
    const currentSize = Number(state.settings.fontSize) || 16;
    const currentTheme = state.settings.theme || "auto";
    const sizes = [
      { value: 14, label: "Petita", hint: "14 px" },
      { value: 16, label: "Mitjana", hint: "16 px" },
      { value: 18, label: "Gran", hint: "18 px" },
      { value: 21, label: "Molt gran", hint: "21 px" },
    ];
    const selected = sizes.reduce(
      (best, size) =>
        Math.abs(size.value - currentSize) < Math.abs(best.value - currentSize)
          ? size
          : best,
      sizes[0],
    );
    const themes = [
      { value: "auto", label: "Automàtic", iconName: "Monitor" },
      { value: "light", label: "Clar", iconName: "Sun" },
      { value: "dark", label: "Obscur", iconName: "Moon" },
    ];

    return `
    <div class="modal-backdrop setup-preferences-backdrop">
      <section class="entry-modal setup-preferences-modal" role="dialog" aria-modal="true" aria-labelledby="setup-preferences-title" aria-describedby="setup-preferences-desc">
        <header class="modal-header">
          <h2 id="setup-preferences-title">Abans de començar</h2>
        </header>
        <div class="modal-scroll">
          <p class="helper" id="setup-preferences-desc">Tria com vols veure SherLock. Ho pots canviar quan vulguis des de Configuració.</p>

          <div class="setup-preferences-group">
            <h3>Tema</h3>
            <div class="setup-theme-options" role="group" aria-label="Tema">
              ${themes
                .map(
                  (theme) => `
                <button type="button" class="setup-theme-choice ${theme.value === currentTheme ? "selected" : ""}" data-setup-theme="${theme.value}" aria-pressed="${theme.value === currentTheme}">
                  ${icon(theme.iconName, 20)}
                  <span>${theme.label}</span>
                </button>
              `,
                )
                .join("")}
            </div>
          </div>

          <div class="setup-preferences-group">
            <div class="setup-preferences-heading">
              <h3>Mida del text</h3>
              <span id="font-size-preview-value">${currentSize} px</span>
            </div>
            <fieldset class="font-size-choices">
              <legend class="sr-only">Mida del text</legend>
              ${sizes
                .map(
                  (size) => `
                <label class="font-size-choice">
                  <input type="radio" name="font-size-choice" value="${size.value}" ${size === selected ? "checked" : ""} />
                  <span class="font-size-choice-copy">
                    <strong>${size.label}</strong>
                    <small>${size.hint}</small>
                  </span>
                  <span class="font-size-choice-sample" aria-hidden="true" style="font-size: ${size.value}px">Aa</span>
                </label>
              `,
                )
                .join("")}
            </fieldset>
            <div class="font-size-preview" id="font-size-preview" style="font-size: ${currentSize}px">
              <strong>La teva caixa forta, a la teva mida.</strong>
              <span>Aquest és un exemple del text que veuràs a SherLock.</span>
            </div>
          </div>
        </div>
        <footer class="modal-footer">
          <button type="button" class="secondary" id="skip-setup-preferences">Més tard</button>
          <button type="button" class="primary" id="confirm-setup-preferences">Continua</button>
        </footer>
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
      ${sidebarComponent(state)}
      <section class="workspace">
        <header class="topbar">
          <div>
            <p class="eyebrow">EL TEU SherLock</p>
            <h1>Les teves contrasenyes</h1>
            <p class="subtitle">Tot el que necessites, protegit i a mà.</p>
          </div>
          <div class="header-actions">
            <button class="lock-button trash-button" id="open-trash" title="Paperera (${state.trash.length})" aria-label="Obrir la paperera (${state.trash.length} elements)">
              ${icon("Trash2", 17)}
              ${state.trash.length ? `<span class="trash-count">${state.trash.length}</span>` : ""}
            </button>
            <button class="lock-button" id="refresh-vault" title="Actualitzar accessos">
              ${icon("RefreshCw", 17)}
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

        ${
          state.showTrashHint
            ? `
          <div class="trash-hint" role="note" aria-label="Consell sobre la paperera">
            ${icon("Trash2", 18)}
            <p class="trash-hint-text"><strong>Consell:</strong> si elimines un accés, anirà a la Paperera i el podràs recuperar quan vulguis.</p>
            <button type="button" class="secondary trash-hint-action" id="trash-hint-open">Veure la paperera</button>
            <button type="button" class="icon-btn trash-hint-close" id="trash-hint-dismiss" title="Tancar" aria-label="Tancar el consell">${icon("X", 16)}</button>
          </div>
        `
            : ""
        }

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
    ${state.appDialog ? appDialogModal() : ""}
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
          <output class="generated-value" draggable="true" title="Arrossega-la a un camp de text">${escapeHtml(state.generatedValue || generateValue(state.generatorType, state.generatorOptions, state.generatorLanguage))}</output>
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
    ${state.appDialog ? appDialogModal() : ""}
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
            ${icon("KeyRound", 18)} Canvia la contrasenya mestra
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
                  Connectat com a <strong>${escapeHtml(state.cloudConfig.authUser)}</strong>
                </span>
                <span class="cloud-status-provider">
                  ${state.cloudConfig.railwayUrl ? "Servidor propi" : "Núvol oficial"}
                </span>
              </div>
              <p class="helper helper-top">La teva SherLock es guarda xifrada. El servidor no la pot llegir.</p>
              <div class="cloud-sync-row">
                <button type="button" class="primary" id="btn-cloud-sync-now" ${state.cloudSyncStatus?.phase === "syncing" ? 'disabled aria-busy="true"' : 'aria-busy="false"'}>
                  <span class="cloud-sync-icon ${state.cloudSyncStatus?.phase === "syncing" ? "is-spinning" : ""}">${icon("RefreshCw", 16)}</span>
                  ${state.cloudSyncStatus?.phase === "syncing" ? "Sincronitzant…" : "Sincronitzar"}
                </button>
                <span class="cloud-last-sync">Última sincronització: ${state.cloudConfig.lastSyncAt ? formatRelativeTime(state.cloudConfig.lastSyncAt, Date.now()) : "Encara no s'ha sincronitzat en aquest dispositiu"}</span>
              </div>
              <p class="cloud-sync-status ${state.cloudSyncStatus?.phase === "error" ? "is-error" : ""}" aria-live="polite">${escapeHtml(state.cloudSyncStatus?.text || "")}</p>
              <details class="cloud-more" ${state.cloudMoreOpen ? "open" : ""}>
                <summary>Més opcions</summary>
                <div class="cloud-more-actions">
                  <button type="button" class="secondary danger" id="btn-cloud-logout">${icon("LogOut", 16)} Tancar sessió</button>
                  <button type="button" class="secondary danger" id="btn-cloud-delete-account">${icon("Trash2", 16)} Eliminar compte i dades del núvol</button>
                </div>
              </details>
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
              <strong>Mida del text</strong>
              <small>Tria una mida còmoda. Es desa automàticament.</small>
            </span>
            <div class="slider-wrapper">
              <input
                id="font-size-setting"
                type="range"
                min="14"
                max="24"
                step="1"
                value="${fontSizeValue}"
                aria-label="Mida del text"
              />
              <output id="font-size-value" for="font-size-setting">${fontSizeValue} px</output>
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
    ${state.showResetConfirm ? resetConfirmModal() : ""}
    ${state.showCloudLogin ? cloudLoginModal() : ""}
    ${state.showPrivacyPolicy ? privacyPolicyModal() : ""}
    ${state.appDialog ? appDialogModal() : ""}
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

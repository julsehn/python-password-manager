import { icon, folderColors, folderIcons } from "./constants.js";
import {
  cloudUsernameStatus,
  escapeHtml,
  formatDate,
  formatRelativeTime,
  parseEntryNotes,
} from "./utils.js";
import {
  passwordStrength,
  passwordRequirementsMarkup,
  passwordStrengthMarkup,
} from "./generator.js";
import { trashCard } from "./modals.js";
import { privacyPolicyHtml } from "./privacy-policy.js";

export function createDialogViews(state) {
  function downloadPasswordModal() {
    return `
    <div class="modal-backdrop">
      <section class="entry-modal master-password-modal" role="dialog" aria-modal="true" aria-labelledby="download-password-title">
        <header class="modal-header">
          <button class="modal-icon" id="cancel-download-password" title="Tancar">${icon("X", 20)}</button>
          <h2 id="download-password-title">Contrasenya mestra</h2>
        </header>
        <div class="modal-scroll">
          <p class="helper">Introdueix la contrasenya mestra per desxifrar la còpia de Railway:</p>
          <form id="download-password-form">
            <label class="form-label" for="download-password-input">Contrasenya mestra</label>
            <input
              class="form-input"
              id="download-password-input"
              type="password"
              autocomplete="off"
              required
              autofocus
            />
            <p class="error form-error" id="download-password-error"></p>
          </form>
        </div>
        <footer class="modal-footer">
          <button type="button" class="secondary" id="cancel-download-password-bottom">Cancel·la</button>
          <button type="submit" form="download-password-form" class="primary">Continuar</button>
        </footer>
      </section>
    </div>
  `;
  }

  function privacyPolicyModal() {
    return `
    <div class="modal-backdrop privacy-policy-backdrop">
      <section class="entry-modal privacy-policy-modal" role="dialog" aria-modal="true" aria-labelledby="privacy-policy-title">
        <header class="modal-header">
          <button class="modal-icon" id="close-privacy-policy" title="Tancar">${icon("X", 20)}</button>
          <h2 id="privacy-policy-title">Política de privacitat</h2>
        </header>
        <div class="modal-scroll privacy-policy-scroll">
          <p class="helper">Text oficial del servei Password Manager Cloud.</p>
          <div class="privacy-policy-content">${privacyPolicyHtml}</div>
        </div>
        <footer class="modal-footer">
          <button type="button" class="secondary" id="close-privacy-policy-bottom">Tanca</button>
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
          <h2 id="change-auth-title">Canvia la contrasenya mestra</h2>
        </header>
        <div class="modal-scroll">
          <div class="change-auth-password-fields">
            <p class="helper">La caixa es tornarà a xifrar i conservarà tots els accessos. Tria una contrasenya mestra nova.</p>
            <label class="form-label" for="change-auth-new-password">Contrasenya mestra nova</label>
            <input class="form-input" id="change-auth-new-password" type="password" autocomplete="new-password" required />
            <div class="password-setup-feedback" id="change-auth-password-feedback">
              ${passwordStrengthMarkup("")}
              ${passwordRequirementsMarkup("")}
            </div>
            <label class="form-label" for="change-auth-confirm-password">Confirma la contrasenya nova</label>
            <input class="form-input" id="change-auth-confirm-password" type="password" autocomplete="new-password" required />
            <p class="password-match" data-password-match hidden aria-live="polite"></p>
          </div>
          <p class="error" id="change-auth-error" ${state.changeAuthError ? "" : "hidden"}>${escapeHtml(state.changeAuthError)}</p>
        </div>
        <footer class="modal-footer">
          <button type="button" class="secondary" id="cancel-change-auth-bottom">Cancel·la</button>
          <button type="button" class="primary" id="save-auth-method" ${state.changeAuthBusy ? "disabled" : ""}>${state.changeAuthBusy ? "Canviant..." : "Canvia la contrasenya"}</button>
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
          text: "Fes clic a «Nou accés» per començar a guardar el teu primer servei.",
        },
        2: {
          kicker: "PAS 2 DE 5",
          title: "Afegeix les dades",
          text: "Escriu el nom del servei. Quan vulguis, prem «Continuar» per veure com generar una contrasenya segura.",
        },
        3: {
          kicker: "PAS 3 DE 5",
          title: "Genera una contrasenya segura",
          text: "Fes clic a «Generar», al costat del camp de contrasenya, per obrir el generador.",
        },
        4: {
          kicker: "PAS 4 DE 5",
          title: "Utilitza la contrasenya",
          text: "Revisa la suggerència i prem «Utilitza aquesta contrasenya» per tornar al formulari.",
        },
        5: {
          kicker: "PAS 5 DE 5",
          title: "Desa el teu accés",
          text: "Quan els camps obligatoris estiguin plens, prem «Guarda» per desar l'accés.",
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
              <button class="icon-btn" id="reveal-details-password" title="Mostrar contrasenya" aria-label="Mostrar contrasenya" aria-pressed="false">
                <span class="eye-open">${icon("Eye", 17)}</span>
                <span class="eye-off">${icon("EyeOff", 17)}</span>
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
                class="form-input ${state.showFirstEntryGuide && state.firstEntryGuideStep === 2 ? "guide-highlight" : ""}"
                id="entry-name"
                name="site"
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
              <div class="input-with-actions ${values.password ? "has-password" : ""}">
                <input
                  class="form-input"
                  id="entry-password"
                  name="password"
                  type="password"
                  required
                  autocomplete="new-password"
                  value="${escapeHtml(values.password)}"
                />
                <div class="field-actions">
                  <button type="button" class="field-action" id="entry-password-reveal" title="Mostrar contrasenya" aria-label="Mostrar contrasenya" aria-pressed="false">
                    <span class="eye-open">${icon("Eye", 18)}</span>
                    <span class="eye-off">${icon("EyeOff", 18)}</span>
                  </button>
                  <button type="button" class="field-action ${state.showFirstEntryGuide && state.firstEntryGuideStep === 3 ? "guide-highlight" : ""}" id="generate-password" title="Obrir el generador" aria-label="Obrir el generador de contrasenyes">
                    ${icon("RefreshCw", 18)}
                    <span class="field-action-text">Generar</span>
                  </button>
                </div>
              </div>
              <div class="inline-password-strength" id="entry-password-strength" ${values.password ? "" : "hidden"}>
                <div class="strength-label"><span>Força</span><strong>${values.password ? passwordStrength(values.password).label : ""}</strong></div>
                <div class="strength-track"><span class="strength-fill strength-${values.password ? passwordStrength(values.password).level : "weak"} strength-width-${values.password ? passwordStrength(values.password).percent : 0}"></span></div>
                <small>${values.password ? passwordStrength(values.password).hint : ""}</small>
              </div>
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
            <button type="submit" id="save-entry-bottom" class="primary ${state.showFirstEntryGuide && state.firstEntryGuideStep === 5 ? "guide-highlight" : ""}" ${state.saving ? "disabled" : ""}>
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
              <button class="danger-btn compact-danger" id="empty-trash-btn">
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
          <p>Aquesta acció eliminarà la SherLock local, la paperera i l'historial. No es pot desfer.</p>
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

  function appDialogModal() {
    const d = state.appDialog || {};
    const requireText = d.requireText || "";
    const passwordLabel = d.passwordLabel || "";
    const danger = Boolean(d.danger);
    const requireValue = d.requireTextValue || "";
    const passwordValue = d.passwordValue || "";
    const thirdLabel = d.thirdLabel || "";
    const requireOk = !requireText || requireValue === requireText;
    const passwordOk = !passwordLabel || passwordValue.length > 0;
    const disabled = !requireOk || !passwordOk;

    return `
    <div class="modal-backdrop" id="app-dialog-backdrop">
      <section class="entry-modal" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title">
        <header class="modal-header">
          <button class="modal-icon" id="app-dialog-cancel" title="Cancel·lar">
            ${icon("X", 20)}
          </button>
          <h2 id="app-dialog-title">${escapeHtml(d.title || "")}</h2>
        </header>
        <div class="modal-scroll">
          <p>${escapeHtml(d.message || "")}</p>
          ${d.confirmHelp ? `<p class="dialog-choice-help">${escapeHtml(d.confirmHelp)}</p>` : ""}
          ${
            requireText
              ? `
          <div class="form-section">
            <label class="form-label" for="app-dialog-require-text">Per confirmar, escriviu <strong>"${escapeHtml(requireText)}"</strong>:</label>
            <input type="text" id="app-dialog-require-text" class="form-input" autocomplete="off" value="${escapeHtml(requireValue)}" />
          </div>
          `
              : ""
          }
          ${
            passwordLabel
              ? `
          <div class="form-section">
            <label class="form-label" for="app-dialog-password">${escapeHtml(passwordLabel)}</label>
            <input type="password" id="app-dialog-password" class="form-input" autocomplete="off" value="${escapeHtml(passwordValue)}" />
          </div>
          `
              : ""
          }
        </div>
        <footer class="modal-footer">
          <button type="button" class="secondary" id="app-dialog-cancel-bottom">Cancel·lar</button>
          ${
            thirdLabel
              ? `<div class="dialog-choice-group"><button type="button" class="secondary" id="app-dialog-third">${escapeHtml(thirdLabel)}</button>${d.thirdHelp ? `<small class="dialog-choice-help">${escapeHtml(d.thirdHelp)}</small>` : ""}</div>`
              : ""
          }
          <button type="button" class="${danger ? "danger-btn" : "primary"}" id="app-dialog-confirm" ${disabled ? "disabled" : ""}>
            ${escapeHtml(d.confirmLabel || "Acceptar")}
          </button>
        </footer>
      </section>
    </div>
  `;
  }

  function cloudLoginModal() {
    const config = state.cloudConfig;
    const isDownloadContext = state.cloudActionContext === "download";
    const activeTab = state.cloudTab || "login";
    const isAuthenticated = Boolean(config.authUser && config.vaultId);
    const usernameStatus = cloudUsernameStatus({
      tab: activeTab,
      checking: state.cloudUsernameChecking,
      available: state.cloudUsernameAvailable,
      error: state.cloudUsernameCheckError,
    });
    const usernameInputTone =
      usernameStatus.tone === "available"
        ? "is-available"
        : usernameStatus.tone === "taken" || usernameStatus.tone === "error"
          ? "is-taken"
          : "";

    if (isAuthenticated && !isDownloadContext) {
      return `
      <div class="modal-backdrop">
        <section class="entry-modal" role="dialog" aria-modal="true" aria-labelledby="cloud-login-title">
          <header class="modal-header">
            <button class="modal-icon" id="cancel-cloud-login" title="Tancar">${icon("X", 20)}</button>
            <div>
              <h2 id="cloud-login-title">${icon("Cloud", 20)} Connexió amb Railway</h2>
              <p class="modal-subtitle">
                Estat de la sincronització al núvol oficial
              </p>
            </div>
          </header>
          <div class="modal-scroll">
            <div class="cloud-status-card">
              <div class="cloud-status-header">
                <span class="cloud-badge">
                  <span class="cloud-badge-dot"></span>
                  Connectat com a <strong>${escapeHtml(config.authUser)}</strong>
                </span>
                <span class="cloud-status-provider">
                  ${config.railwayUrl ? "Servidor propi" : "Núvol oficial"}
                </span>
              </div>
            </div>

            <p class="helper">La teva SherLock es guarda xifrada. El servidor no la pot llegir.</p>

            <div class="cloud-sync-row cloud-modal-sync-row">
              <button type="button" class="primary full" data-cloud-action="sync" ${state.cloudSyncStatus?.phase === "syncing" ? 'disabled aria-busy="true"' : 'aria-busy="false"'}>
                <span class="cloud-sync-icon ${state.cloudSyncStatus?.phase === "syncing" ? "is-spinning" : ""}">${icon("RefreshCw", 16)}</span>
                ${state.cloudSyncStatus?.phase === "syncing" ? "Sincronitzant…" : "Sincronitzar"}
              </button>
              <span class="cloud-last-sync">Última sincronització: ${state.cloudConfig.lastSyncAt ? formatRelativeTime(state.cloudConfig.lastSyncAt, Date.now()) : "Encara no s'ha sincronitzat en aquest dispositiu"}</span>
            </div>
            <p class="cloud-sync-status ${state.cloudSyncStatus?.phase === "error" ? "is-error" : ""}" aria-live="polite">${escapeHtml(state.cloudSyncStatus?.text || "")}</p>
            <details class="cloud-more" ${state.cloudMoreOpen ? "open" : ""}>
              <summary>Més opcions</summary>
              <div class="cloud-more-actions">
                <button type="button" class="secondary full danger" data-cloud-action="logout">
                  ${icon("LogOut", 16)} Tancar sessió a Railway
                </button>
                <button type="button" class="secondary full danger" data-cloud-action="delete-account">
                  ${icon("Trash2", 16)} Eliminar compte i dades del núvol
                </button>
              </div>
            </details>
          </div>
          <footer class="modal-footer">
            <button type="button" class="secondary" id="cancel-cloud-login">Tancar</button>
          </footer>
        </section>
      </div>
    `;
    }

    return `
    <div class="modal-backdrop">
      <section class="entry-modal" role="dialog" aria-modal="true" aria-labelledby="cloud-login-title">
        <header class="modal-header">
          <button class="modal-icon" id="cancel-cloud-login" title="Tancar">${icon("X", 20)}</button>
          <div>
            <h2 id="cloud-login-title">${icon("Cloud", 20)} Connexió amb Railway</h2>
            <p class="modal-subtitle">
              ${isDownloadContext ? "Restaura la teva SherLock des del núvol oficial" : "Sincronització segura al núvol de Railway"}
            </p>
          </div>
        </header>

        <form id="cloud-login-form">
          <div class="modal-scroll">
            <!-- Tabs -->
            <div class="cloud-tabs">
              <button type="button" class="cloud-tab ${activeTab === "login" ? "active" : ""}" id="tab-cloud-login">
                ${icon("LogIn", 16)} Iniciar sessió
              </button>
              <button type="button" class="cloud-tab ${activeTab === "register" ? "active" : ""}" id="tab-cloud-register">
                ${icon("UserPlus", 16)} Crear compte
              </button>
            </div>

            <!-- Zero-knowledge info box -->
            <div class="cloud-info-box">
              ${icon("ShieldCheck", 18)}
              <span>
                <strong>Privacitat d'extrem a extrem:</strong> La instància oficial de Railway només emmagatzema les credencials del compte i la teva SherLock xifrada. El servidor no pot desxifrar ni llegir mai les teves contrasenyes.
              </span>
            </div>

            <div class="cloud-error-banner" id="cloud-error-banner" ${state.cloudError ? "" : "hidden"}>
              ${icon("AlertCircle", 18)}
              <span id="cloud-error-text">${escapeHtml(state.cloudError || "")}</span>
            </div>

            <!-- Common Username -->
            <div class="form-section">
              <label class="form-label" for="auth-username">Nom d'usuari a Railway:</label>
              <div class="username-field ${usernameStatus.label ? "has-status" : ""}">
                <input
                  class="form-input ${usernameInputTone}"
                  id="auth-username"
                  name="username"
                  type="text"
                  required
                  minlength="3"
                  placeholder="Ex. joan"
                  value="${escapeHtml(state.cloudFormUsername || config.authUser || "")}"
                  autofocus
                  aria-describedby="auth-username-hint"
                  ${usernameStatus.tone === "taken" ? 'aria-invalid="true"' : ""}
                />
                <span class="username-status is-${usernameStatus.tone}" id="auth-username-status" role="status" aria-live="polite">${escapeHtml(usernameStatus.label)}</span>
              </div>
              <small class="username-hint is-${usernameStatus.tone}" id="auth-username-hint" ${usernameStatus.hint ? "" : "hidden"}>${escapeHtml(usernameStatus.hint)}</small>
            </div>

            <!-- Common Password -->
            <div class="form-section">
              <label class="form-label" for="auth-password">Contrasenya de Railway:</label>
              <div class="password-input-wrapper">
                <input
                  id="auth-password"
                  name="password"
                  type="password"
                  required
                  minlength="${activeTab === "register" ? "12" : "1"}"
                  placeholder="${activeTab === "register" ? "Mínim 12 caràcters" : "La teva contrasenya de Railway"}"
                  class="form-input cloud-password-input"
                />
                <button type="button" class="reveal cloud-password-reveal" id="reveal-cloud-password" title="Mostrar contrasenya" aria-label="Mostrar contrasenya" aria-pressed="false">
                  <span class="eye-open">${icon("Eye", 16)}</span>
                  <span class="eye-off">${icon("EyeOff", 16)}</span>
                </button>
              </div>
              ${
                activeTab === "register"
                  ? `
                <p class="helper helper-small helper-top-small">No pot ser la mateixa que la contrasenya mestra de la SherLock.</p>
                <div class="password-setup-feedback cloud-password-feedback" id="cloud-password-feedback">
                  ${passwordStrengthMarkup("")}
                  ${passwordRequirementsMarkup("", "La contrasenya de Railway ha de complir:", "Requisits de la contrasenya de Railway")}
                  <p class="password-match" data-password-match hidden aria-live="polite"></p>
                </div>
                <p class="cloud-password-warning" id="cloud-password-warning" role="alert" hidden></p>
              `
                  : ""
              }
            </div>

            ${
              activeTab === "register"
                ? `
              <!-- Register: Confirm Password -->
              <div class="form-section">
                <label class="form-label" for="auth-confirm-password">Confirma la contrasenya de Railway:</label>
                <input
                  class="form-input"
                  id="auth-confirm-password"
                  name="confirmPassword"
                  type="password"
                  required
                  minlength="12"
                  placeholder="Repeteix la contrasenya"
                />
              </div>

              <!-- Register: Privacy Policy -->
              <div class="form-section privacy-section">
                <label class="form-checkbox privacy-checkbox" for="privacy-accepted">
                  <input type="checkbox" id="privacy-accepted" name="privacyAccepted" required />
                  <span>He llegit i accepto la <button type="button" class="policy-link" id="open-privacy-policy">Política de privacitat</button></span>
                </label>
              </div>
            `
                : ""
            }

            ${
              isDownloadContext && activeTab === "login"
                ? `
              <!-- Download context: Master Password -->
              <div class="form-section master-password-section download-master-password">
                <label class="form-label" for="auth-master-password">
                  ${icon("KeyRound", 14)} Contrasenya mestra de la SherLock:
                </label>
                <input
                  class="form-input"
                  id="auth-master-password"
                  name="masterPassword"
                  type="password"
                  placeholder="Contrasenya per desxifrar la SherLock descarregada"
                  required
                />
                <p class="helper helper-small helper-top-small">
                  Necessària per desxifrar la còpia de seguretat un cop descarregada de Railway.
                </p>
              </div>
            `
                : ""
            }

            <!-- Advanced / Custom Server Toggle -->
            <div class="cloud-advanced-toggle-wrap">
              <button type="button" class="cloud-advanced-toggle" id="toggle-cloud-advanced">
                ${icon(state.cloudShowAdvanced ? "ChevronDown" : "ChevronRight", 14)}
                Opcions avançades (Servidor personalitzat)
              </button>
              ${
                state.cloudShowAdvanced
                  ? `
                <div class="cloud-advanced-panel">
                  <div class="form-section">
                    <label class="form-label" for="cloud-railway-url">URL del servidor Railway:</label>
                    <input
                      class="form-input"
                      id="cloud-railway-url"
                      name="railwayUrl"
                      type="url"
                      placeholder="https://password-manager-cloud-production.up.railway.app"
                      value="${escapeHtml(config.railwayUrl || "")}"
                    />
                    <small class="helper helper-small">
                      Deixa buit per defecte per utilitzar el servidor oficial de Railway.
                    </small>
                  </div>
                  <div class="form-section form-section-spaced">
                    <label class="form-label" for="cloud-vault-id">Identificador de SherLock (opcional):</label>
                    <input
                      class="form-input"
                      id="cloud-vault-id"
                      name="vaultId"
                      type="text"
                      placeholder="Assignat automàticament pel compte"
                      value="${escapeHtml(config.vaultId || "")}"
                    />
                  </div>
                  <p class="helper">Fes servir una contrasenya diferent de la contrasenya mestra de la SherLock.</p>
                </div>
              `
                  : ""
              }
            </div>
          </div>

          <footer class="modal-footer">
            <button type="button" class="secondary" id="cancel-cloud-login">Cancel·la</button>
            <button type="submit" class="primary" ${state.cloudLoading ? "disabled" : ""}>
              ${
                state.cloudLoading
                  ? `${icon("Loader", 16)} Processant...`
                  : activeTab === "register"
                    ? `${icon("UserPlus", 16)} Crear compte a Railway`
                    : isDownloadContext
                      ? `${icon("DownloadCloud", 16)} Iniciar sessió i descarregar`
                      : `${icon("LogIn", 16)} Iniciar sessió`
              }
            </button>
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
              <input class="form-input" id="folder-name" name="folderName" maxlength="80" required autofocus value="${escapeHtml(folder.name)}" placeholder="Ex. Feina" />

              <label class="form-label">Icona</label>
              <div class="folder-picker" role="group" aria-label="Icona de la carpeta">
                ${folderIcons.map((name) => `<button class="folder-choice ${folder.icon === name ? "selected" : ""}" type="button" data-folder-icon="${name}" title="${name}">${icon(name, 19)}</button>`).join("")}
              </div>
              <input type="hidden" id="folder-icon" name="icon" value="${escapeHtml(folder.icon)}" />

              <label class="form-label">Color</label>
              <div class="folder-picker" role="group" aria-label="Color de la carpeta">
                ${folderColors.map((color, index) => `<button class="folder-color folder-swatch-${index} ${folder.color === color ? "selected" : ""}" type="button" data-folder-color="${color}" title="${color}"></button>`).join("")}
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
  return {
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
  };
}

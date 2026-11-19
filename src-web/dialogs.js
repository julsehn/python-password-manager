import { icon, folderColors, folderIcons } from "./constants.js";
import { escapeHtml, formatDate, parseEntryNotes } from "./utils.js";
import { passwordStrength } from "./generator.js";
import { trashCard } from "./modals.js";

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

  function welcomeModal() {
    const slides = [
      {
        icon: "ShieldCheck",
        kicker: "PROTECCIÓ LOCAL",
        title: "Tot el que necessites, en un sol lloc",
        text: "SherLock guarda els teus accessos de manera local i protegida, perquè els tinguis sempre a mà.",
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
        text: "Després podràs guardar llocs web, usuaris, contrasenyes i notes privades dins la teva SherLock.",
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
            <h2 id="welcome-title">Benvingut a SherLock</h2>
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
              <p>Utilitza una contrasenya text per obrir la SherLock.</p>
            </button>
            <button class="auth-method-card ${state.authMethodSelected === "image" ? "selected" : ""}" id="auth-method-image">
              ${icon("Camera", 32)}
              <h3>Autenticació amb imatge</h3>
              <p>Utilitza una imatge i punts de clic per autenticar-te.</p>
            </button>
            <button class="auth-method-card" id="auth-method-cloud-download">
              ${icon("Cloud", 32)}
              <h3>Descarregar des del núvol</h3>
              <p>Si ja tens una caixa al núvol, descarrega-la i desbloqueja-la amb la contrasenya mestra.</p>
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
            <p class="hint">Selecciona 12 punts diferents en ordre. La seqüència és la clau d'accés.</p>
          </div>
          <div class="image-upload-area" id="image-upload-area" ${state.imageAuthImage ? "hidden" : ""}>
            <p>${icon("Camera", 40)}</p>
            <p>Fes clic per pujar la teva imatge</p>
            <input type="file" accept="image/*" id="image-auth-upload" class="file-input-hidden" />
          </div>
          <div class="image-auth-canvas-area" id="image-auth-canvas-area" ${state.imageAuthImage ? "" : "hidden"}>
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
    return `
    <div class="modal-backdrop image-auth-modal-backdrop">
      <section class="entry-modal image-auth-unlock-modal" role="dialog" aria-modal="true" aria-labelledby="image-auth-unlock-title">
        <header class="modal-header">
          <button class="modal-icon" id="cancel-image-auth-unlock" title="Tancar">${icon("X", 20)}</button>
          <h2 id="image-auth-unlock-title">Desbloqueja amb la teva imatge</h2>
        </header>
        <div class="modal-scroll">
          <div class="image-auth-instructions">
            <p>Marca els mateixos 12 punts, en el mateix ordre.</p>
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
                <div class="unlock-progress-track" role="progressbar" aria-label="Desxifrant la SherLock" aria-valuetext="En curs">
                  <span class="unlock-progress-indicator"></span>
                </div>
                <span>Verificant el patró i desxifrant la SherLock…</span>
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
              <p>Tria una contrasenya mestra nova per obrir la SherLock.</p>
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
                <button type="button" class="field-action" id="entry-password-reveal" title="Mostrar contrasenya">
                  ${icon("Eye", 18)}
                </button>
                <button type="button" class="field-action ${state.showFirstEntryGuide && state.firstEntryGuideStep === 3 ? "guide-highlight" : ""}" id="generate-password" title="Obrir el generador" aria-label="Obrir el generador de contrasenyes">
                  ${icon("RefreshCw", 18)}
                  <span class="field-action-text">Generar</span>
                </button>
              </div>
              <div class="inline-password-strength" id="entry-password-strength" ${values.password ? "" : "hidden"}>
                <div class="strength-label"><span>Força</span><strong>${values.password ? passwordStrength(values.password).label : ""}</strong></div>
                <div class="strength-track"><span class="strength-fill strength-${values.password ? passwordStrength(values.password).level : "weak"} strength-width-${values.password ? passwordStrength(values.password).percent : 0}"></span></div>
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

  function cloudLoginModal() {
    const config = state.cloudConfig;
    const isDownloadContext = state.cloudActionContext === "download";
    const activeTab = state.cloudTab || "login";
    const isAuthenticated = Boolean(config.authUser && config.token);

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
                  Sessió activa a Railway
                </span>
                <span class="cloud-status-provider">
                  ${config.railwayUrl ? "Servidor personalitzat" : "Núvol oficial"}
                </span>
              </div>
              <div class="cloud-user-meta cloud-user-meta-spaced">
                <span><strong>Usuari:</strong> ${escapeHtml(config.authUser)}</span>
                <span><strong>Identificador:</strong> ${config.vaultId ? escapeHtml(config.vaultId) : "Sincronitzat"}</span>
              </div>
            </div>

            <div class="cloud-info-box">
              ${icon("ShieldCheck", 18)}
              <span>
                <strong>Privacitat garantida:</strong> La SherLock roman sempre xifrada amb AES-256-GCM. El servidor mai coneix la teva contrasenya mestra ni pot desxifrar les teves dades.
              </span>
            </div>

            <div class="form-section cloud-actions-form">
              <button type="button" class="primary full" id="btn-cloud-sync-modal" ${state.cloudLoading ? "disabled" : ""}>
                ${icon("RefreshCw", 16)} Sincronitzar ara (Pujar canvis)
              </button>
              <button type="button" class="secondary full" id="btn-cloud-download-modal" ${state.cloudLoading ? "disabled" : ""}>
                ${icon("DownloadCloud", 16)} Descarregar còpia del núvol
              </button>
              <button type="button" class="secondary full danger" id="btn-cloud-logout-modal">
                ${icon("LogOut", 16)} Tancar sessió a Railway
              </button>
            </div>
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

            ${
              state.cloudError
                ? `
              <div class="cloud-error-banner">
                ${icon("AlertCircle", 18)}
                <span>${escapeHtml(state.cloudError)}</span>
              </div>
            `
                : ""
            }

            <!-- Common Username -->
            <div class="form-section">
              <label class="form-label" for="auth-username">Nom d'usuari a Railway:</label>
              <div style="position:relative;">
                <input
                  class="form-input"
                  id="auth-username"
                  name="username"
                  type="text"
                  required
                  minlength="3"
                  placeholder="Ex. joan"
                  value="${escapeHtml(state.cloudFormUsername || config.authUser || "")}"
                  autofocus
                  style="${activeTab === "register" && state.cloudUsernameAvailable === false ? "border-color:var(--color-danger,#dc2626);" : activeTab === "register" && state.cloudUsernameAvailable === true ? "border-color:var(--color-success,#16a34a);" : ""}"
                />
                ${
                  activeTab === "register" && state.cloudUsernameChecking
                    ? `<span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:12px;color:var(--color-muted);">${icon("Loader", 14)} Verificant...</span>`
                    : activeTab === "register" &&
                        state.cloudUsernameAvailable === true
                      ? `<span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:12px;color:var(--color-success,#16a34a);">${icon("Check", 14)} Disponible</span>`
                      : activeTab === "register" &&
                          state.cloudUsernameAvailable === false
                        ? `<span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:12px;color:var(--color-danger,#dc2626);">${icon("X", 14)} No disponible</span>`
                        : ""
                }
              </div>
            </div>

            <!-- Common Password -->
            <div class="form-section">
              <label class="form-label" for="auth-password">Contrasenya de Railway:</label>
              <div class="password-input-wrapper">
                <input
                  class="form-input"
                  id="auth-password"
                  name="password"
                  type="password"
                  required
                  minlength="${activeTab === "register" ? "8" : "1"}"
                  placeholder="${activeTab === "register" ? "Mínim 8 caràcters" : "La teva contrasenya de Railway"}"
                  class="form-input cloud-password-input"
                  ${activeTab === "register" && state.cloudUsernameAvailable !== true ? 'disabled title="Comprova primer el nom d\'usuari"' : ""}
                />
                <button type="button" class="reveal cloud-password-reveal" id="reveal-cloud-password" title="Mostrar/Amagar">
                  ${icon("Eye", 16)}
                </button>
              </div>
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
                  minlength="8"
                  placeholder="Repeteix la contrasenya"
                />
              </div>

              <!-- Register: Privacy Policy -->
              <div class="form-section privacy-section">
                <label class="form-checkbox privacy-checkbox" for="privacy-accepted">
                  <input type="checkbox" id="privacy-accepted" name="privacyAccepted" required />
                  <span>He llegit i accepto la <a href="PRIVACY_POLICY.md" target="_blank" class="policy-link">Política de Privacitat</a></span>
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
              <input class="form-input" id="folder-name" name="name" maxlength="80" required autofocus value="${escapeHtml(folder.name)}" placeholder="Ex. Feina" />

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
  };
}

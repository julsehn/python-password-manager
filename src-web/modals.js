/**
 * SherLock - Modal Dialog Templates
 * Pure template renderers for all application modals and overlay dialogs.
 */

import { icon, folderIcons, folderColors } from "./constants.js";
import { escapeHtml, parseEntryNotes } from "./utils.js";

export function trashCard(item) {
  return `
    <div class="trash-item">
      <div class="site-badge">${icon("Globe", 20)}</div>
      <div class="trash-info">
        <strong>${escapeHtml(item.site)}</strong>
        <span>${escapeHtml(item.username || "Sense nom d'usuari")}</span>
      </div>
      <div class="trash-actions">
        <button class="btn-restore" data-restore-trash="${escapeHtml(item.id)}" title="Restaurar l'accés">
          ${icon("RotateCcw", 14)} Restaura
        </button>
        <button class="btn-delete-perm" data-delete-perm="${escapeHtml(item.id)}" title="Eliminar definitivament">
          ${icon("Trash2", 14)}
        </button>
      </div>
    </div>
  `;
}

export function historyItem(item) {
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

export function welcomeModal(state) {
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

export function authMethodSelectionModal(state) {
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

export function imageAuthSetupModal(state) {
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

export function imageAuthUnlockModal(state) {
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

export function changeAuthMethodModal(state) {
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

export function firstEntryGuideModal(state) {
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

export function entryDetailsModal(state) {
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
              <input class="detail-input" type="${state.revealViewingPassword ? "text" : "password"}" readonly value="${escapeHtml(entry.password)}" />
              <button class="icon-btn" id="toggle-view-password" title="${state.revealViewingPassword ? "Amagar" : "Mostrar"}">
                ${icon(state.revealViewingPassword ? "EyeOff" : "Eye", 17)}
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
                <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="icon-btn" title="Obrir el lloc">
                  ${icon("ExternalLink", 17)}
                </a>
              </div>
            </div>
          `
              : ""
          }

          ${
            cleanNotes
              ? `
            <div class="detail-group">
              <label class="detail-label">Notes privades</label>
              <div class="detail-notes">${escapeHtml(cleanNotes)}</div>
            </div>
          `
              : ""
          }
        </div>

        <footer class="modal-footer">
          <button type="button" class="secondary" id="close-details-bottom">Tancar</button>
        </footer>
      </section>
    </div>
  `;
}

export function entryFormModal(state) {
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
              <input class="form-input ${state.showFirstEntryGuide && state.firstEntryGuideStep === 2 ? "guide-highlight" : ""}" id="entry-name" name="site" required value="${escapeHtml(values.site)}" placeholder="Ex. GitHub, Google, CaixaBank..." />

              <label class="form-label" for="entry-folder">Carpeta</label>
              <select class="form-select" id="entry-folder" name="folderId">
                <option value="">Sense carpeta</option>
                ${state.folders.map((folder) => `<option value="${escapeHtml(folder.id)}" ${values.folderId === folder.id ? "selected" : ""}>${escapeHtml(folder.name)}</option>`).join("")}
              </select>
            </section>

            <section class="form-section">
              <div class="section-heading">
                <span>Dades d'inici de sessió</span>
                ${icon("LockKeyhole", 18)}
              </div>
              <label class="form-label" for="entry-username">Nom d'usuari o correu</label>
              <input class="form-input" id="entry-username" name="username" value="${escapeHtml(values.username)}" placeholder="nom@exemple.cat" />

              <label class="form-label" for="entry-password">Contrasenya</label>
              <div class="password-wrapper ${state.showFirstEntryGuide && state.firstEntryGuideStep === 3 ? "guide-highlight" : ""}">
                <input class="form-input" id="entry-password" name="password" type="${state.revealPassword ? "text" : "password"}" value="${escapeHtml(values.password)}" />
                <button type="button" class="icon-btn" id="toggle-password" title="${state.revealPassword ? "Amagar" : "Mostrar"}">
                  ${icon(state.revealPassword ? "EyeOff" : "Eye", 18)}
                </button>
                <button type="button" class="icon-btn" id="generate-for-entry" title="Generar contrasenya">
                  ${icon("RefreshCw", 18)}
                </button>
              </div>
              <div class="password-meter-wrap">
                <div class="password-meter-bar" style="width: ${Math.min(100, values.password.length * 6)}%"></div>
              </div>
            </section>

            <section class="form-section">
              <div class="section-heading">
                <span>Notes privades i enllaç</span>
                ${icon("ExternalLink", 18)}
              </div>
              <label class="form-label" for="entry-url">URL del servei</label>
              <input class="form-input" id="entry-url" name="url" type="url" value="${escapeHtml(values.url)}" placeholder="https://exemple.cat/login" />

              <label class="form-label" for="entry-notes">Notes addicionals</label>
              <textarea class="form-textarea" id="entry-notes" name="notes" rows="3" placeholder="Preguntes de seguretat, codis de recuperació...">${escapeHtml(values.notes)}</textarea>
            </section>
          </div>

          <footer class="modal-footer">
            <button type="button" class="secondary" id="cancel-entry-bottom">Cancel·la</button>
            <button type="submit" class="primary">${isEditing ? "Desar canvis" : "Crear accés"}</button>
          </footer>
        </form>
      </section>
    </div>
  `;
}

export function folderModal(state) {
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

export function trashModal(state) {
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

export function resetConfirmModal() {
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

export function cloudLoginModal(state) {
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

            ${state.cloudError ? `<p class="error form-error">${escapeHtml(state.cloudError)}</p>` : ""}
          </div>
          <footer class="modal-footer">
            <button type="button" class="secondary" id="cancel-cloud-login-bottom">Tancar</button>
          </footer>
        </section>
      </div>
    `;
  }

  return `
    <div class="modal-backdrop">
      <section class="entry-modal cloud-auth-modal" role="dialog" aria-modal="true" aria-labelledby="cloud-login-title">
        <header class="modal-header">
          <button class="modal-icon" id="cancel-cloud-login" title="Tancar">${icon("X", 20)}</button>
          <div>
            <h2 id="cloud-login-title">${icon("Cloud", 20)} Sincronització Railway</h2>
            <p class="modal-subtitle">
              ${
                isDownloadContext
                  ? "Inicia sessió per descarregar la teva SherLock del núvol"
                  : "Còpia de seguretat xifrada d'extrem a extrem al teu compte de Railway"
              }
            </p>
          </div>
        </header>

        <form id="cloud-auth-form">
          <div class="modal-scroll">
            <div class="cloud-tabs" role="tablist">
              <button type="button" role="tab" class="cloud-tab ${activeTab === "login" ? "active" : ""}" id="tab-cloud-login" aria-selected="${activeTab === "login"}">
                Inicia sessió
              </button>
              <button type="button" role="tab" class="cloud-tab ${activeTab === "register" ? "active" : ""}" id="tab-cloud-register" aria-selected="${activeTab === "register"}">
                Crear compte
              </button>
            </div>

            <div class="cloud-info-box">
              ${icon("ShieldCheck", 18)}
              <span>
                <strong>Xifratge d'extrem a extrem:</strong> Les teves contrasenyes s'encripten al teu dispositiu abans de pujar-les. Railway mai té accés a les teves claus.
              </span>
            </div>

            <section class="form-section">
              <label class="form-label" for="auth-username">Usuari de Railway</label>
              <input class="form-input" id="auth-username" autocomplete="username" required placeholder="nom@exemple.cat" autofocus />

              <label class="form-label" for="auth-password">Contrasenya de Railway</label>
              <input class="form-input" id="auth-password" type="password" autocomplete="${activeTab === "register" ? "new-password" : "current-password"}" required minlength="${activeTab === "register" ? "8" : "1"}" />

              ${
                activeTab === "register"
                  ? `
                <label class="form-label" for="auth-confirm-password">Confirma la contrasenya de Railway</label>
                <input class="form-input" id="auth-confirm-password" type="password" autocomplete="new-password" required minlength="8" />

                <label class="checkbox-label privacy-checkbox">
                  <input type="checkbox" id="privacy-accepted" required />
                  <span>
                    He llegit i accepto la
                    <a href="PRIVACY_POLICY.md" target="_blank" rel="noopener noreferrer">Política de Privacitat</a>.
                  </span>
                </label>
              `
                  : ""
              }

              <details class="advanced-cloud-details">
                <summary>Configuració avançada del servidor</summary>
                <div class="advanced-fields">
                  <label class="form-label" for="cloud-railway-url">URL del servidor Railway personalitzat</label>
                  <input class="form-input" id="cloud-railway-url" type="url" value="${escapeHtml(config.railwayUrl || "")}" placeholder="Buit per defecte" />

                  <label class="form-label" for="cloud-vault-id">Identificador de la SherLock (opcional)</label>
                  <input class="form-input" id="cloud-vault-id" value="${escapeHtml(config.vaultId || "")}" placeholder="Buit per generar-ne un de nou" />
                </div>
              </details>

              ${state.cloudError ? `<p class="error form-error">${escapeHtml(state.cloudError)}</p>` : ""}
            </section>
          </div>

          <footer class="modal-footer">
            <button type="button" class="secondary" id="cancel-cloud-login-bottom">Cancel·la</button>
            <button type="submit" class="primary" id="btn-cloud-submit" ${state.cloudLoading ? "disabled" : ""}>
              ${
                state.cloudLoading
                  ? "Connectant..."
                  : activeTab === "register"
                    ? "Registra't i sincronitza"
                    : "Inicia sessió"
              }
            </button>
          </footer>
        </form>
      </section>
    </div>
  `;
}

export function commandPalette(state) {
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
            <button class="palette-result ${index === state.paletteIndex ? "selected" : ""} ${state.paletteCopiedId === entry.id ? "is-copied" : ""}" data-palette-entry="${escapeHtml(entry.id)}" role="option" aria-selected="${index === state.paletteIndex}">
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

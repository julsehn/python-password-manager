/**
 * SherLock - Small shared card templates.
 *
 * The full dialog templates live in `dialogs.js`; this module only keeps the
 * two small cards that are shared by more than one view.
 */

import { icon } from "./constants.js";
import { escapeHtml } from "./utils.js";

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
      <span class="history-kind">${escapeHtml(item.type || item.kind || "Generador")}</span>
      <code>${escapeHtml(item.value)}</code>
      <button class="icon-btn" data-copy-history="${escapeHtml(item.value)}" title="Copiar">
        ${icon("Copy", 16)}
      </button>
    </div>
  `;
}

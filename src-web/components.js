/**
 * SherLock - UI Components
 * Navigation, sidebar, folder items, and entry card components.
 */

import { icon, folderColors } from "./constants.js";
import { escapeHtml } from "./utils.js";

export function bottomNavComponent(activeTab = "vault") {
  return `
    <footer class="bottom-nav">
      <button class="nav ${activeTab === "vault" ? "active" : ""}" id="nav-vault">
        ${icon("ShieldCheck", 21)}
        <span>SherLock</span>
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

export function folderItem(folder, state) {
  const count = state.entries.filter(
    (entry) => entry.folderId === folder.id,
  ).length;
  const color = folderColors.includes(folder.color)
    ? folder.color
    : folderColors[0];
  const colorIndex = folderColors.indexOf(color);
  return `
    <button class="folder ${state.activeFolderId === folder.id ? "active" : ""}" data-folder="${escapeHtml(folder.id)}">
      <span class="folder-icon palette-color-${colorIndex}">${icon(folder.icon, 17)}</span>
      <span>${escapeHtml(folder.name)}</span>
      <b class="count">${count}</b>
    </button>
  `;
}

export function sidebarComponent(state) {
  return `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark"><img class="brand-icon" src="/brand/SherLock-brand.png" alt="" /></div>
        <span>SherLock</span>
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
        ${state.folders.map((folder) => folderItem(folder, state)).join("")}
      </nav>
    </aside>
  `;
}

export function entryCard(entry) {
  return `
    <article class="entry" data-view-entry="${escapeHtml(entry.id)}">
      <div class="site-badge">${icon("Globe", 22)}</div>
      <div class="entry-info">
        <strong>${escapeHtml(entry.site)}</strong>
        <span>${escapeHtml(entry.username)}</span>
      </div>
      <div class="entry-actions">
        <button class="icon-btn" title="Obrir lloc web" data-open="${escapeHtml(entry.site)}">
          ${icon("ExternalLink")}
        </button>
        <button class="icon-btn copy-action" title="Copiar la contrasenya" data-copy="${escapeHtml(entry.id)}">
          ${icon("Copy")}
        </button>
        <button class="icon-btn more" title="Detalls, editar o eliminar" data-view-action="${escapeHtml(entry.id)}">
          ${icon("MoreHorizontal")}
        </button>
      </div>
    </article>
  `;
}

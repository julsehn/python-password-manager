/**
 * SherLock - Frontend Utilities
 * Pure helper functions for formatting, DOM sanitization, and icons.
 */

import DOMPurify from "dompurify";

export const escapeHtml = (value = "") =>
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

export function sanitizedFragment(markup) {
  return DOMPurify.sanitize(String(markup ?? ""), {
    RETURN_DOM_FRAGMENT: true,
  });
}

export function replaceMarkup(element, markup) {
  element.replaceChildren(sanitizedFragment(markup));
}

export function appendMarkup(element, markup) {
  element.append(sanitizedFragment(markup));
}

export function formatDate(isoString) {
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

export function parseEntryNotes(notes = "") {
  let url = "";
  let cleanNotes = notes;
  if (notes.startsWith("URL: ")) {
    const lines = notes.split("\n");
    url = lines[0].replace(/^URL:\s*/, "").trim();
    cleanNotes = lines.slice(1).join("\n").trim();
  }
  return { url, cleanNotes };
}

export function mapVaultEntry(entry) {
  return {
    id: entry.id,
    site: entry.site,
    username: entry.username,
    password: entry.password,
    notes: entry.notes || "",
    folderId: entry.folder_id || null,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at || null,
  };
}

export const isTauriRuntime = () => Boolean(window.__TAURI_INTERNALS__);

/**
 * Compute remaining seconds until expiration. Returns integer ≥ 0.
 */
export function pairingSecondsRemaining(expiresAt, now = Date.now()) {
  return Math.max(0, Math.floor((expiresAt - now) / 1000));
}

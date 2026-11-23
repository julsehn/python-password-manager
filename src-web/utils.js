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

/**
 * Format relative time in Catalan (tone: "tu").
 * Returns e.g. "ara mateix", "fa 3 min", "fa 2 h", "ahir", or a short date.
 * Empty string when no timestamp is given.
 */
export function formatRelativeTime(timestampMs, nowMs) {
  if (timestampMs === null || timestampMs === undefined) return "";
  if (!Number.isFinite(Number(timestampMs))) return "";
  const diff = nowMs - Number(timestampMs);
  if (diff < 60_000) return "ara mateix";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `fa ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `fa ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ahir";
  if (d < 7) return `fa ${d} dies`;
  try {
    return new Date(Number(timestampMs)).toLocaleDateString("ca-ES", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
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
 * Presentational state for the Railway username availability indicator.
 * Kept pure so the same labels drive the initial render and the in-place
 * updates that follow an availability check.
 */
export function cloudUsernameStatus({ tab, checking, available, error }) {
  if (tab !== "register") {
    return { tone: "idle", label: "", hint: "" };
  }
  if (checking) {
    return { tone: "checking", label: "Comprovant…", hint: "" };
  }
  if (available === true) {
    return {
      tone: "available",
      label: "✓ Disponible",
      hint: "El nom d'usuari està lliure.",
    };
  }
  if (available === false) {
    return {
      tone: "taken",
      label: "✕ No disponible",
      hint: "Aquest nom d'usuari ja existeix. Tria'n un altre.",
    };
  }
  if (error) {
    return {
      tone: "error",
      label: "No verificat",
      hint: String(error),
    };
  }
  return { tone: "idle", label: "", hint: "" };
}

/**
 * Compute remaining seconds until expiration. Returns integer ≥ 0.
 */
export function pairingSecondsRemaining(expiresAt, now = Date.now()) {
  return Math.max(0, Math.floor((expiresAt - now) / 1000));
}

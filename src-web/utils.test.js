import assert from "node:assert/strict";
import test from "node:test";

import {
  cloudUsernameStatus,
  formatRelativeTime,
  mapVaultEntry,
  pairingSecondsRemaining,
} from "./utils.js";

test("mapVaultEntry reads Rust snake_case fields only", () => {
  assert.deepEqual(
    mapVaultEntry({
      id: "entry-1",
      site: "example.test",
      username: "user",
      password: "secret",
      notes: "",
      folder_id: null,
      folderId: "old-folder",
      created_at: "2026-01-02T03:04:05Z",
      createdAt: "old-date",
      updated_at: null,
      updatedAt: "old-update",
      deleted_at: null,
      deletedAt: "old-delete",
    }),
    {
      id: "entry-1",
      site: "example.test",
      username: "user",
      password: "secret",
      notes: "",
      folderId: null,
      createdAt: "2026-01-02T03:04:05Z",
      updatedAt: null,
    },
  );
});

test("pairingSecondsRemaining returns correct value", () => {
  const expiresAt = Date.now() + 150_000;
  const now = Date.now();
  const result = pairingSecondsRemaining(expiresAt, now);
  assert.ok(result >= 149 && result <= 150);
});

test("pairingSecondsRemaining returns 0 when expired", () => {
  const expiresAt = Date.now() - 10_000;
  const now = Date.now();
  const result = pairingSecondsRemaining(expiresAt, now);
  assert.equal(result, 0);
});

test("pairingSecondsRemaining handles missing now parameter", () => {
  const expiresAt = Date.now() + 100_000;
  const result = pairingSecondsRemaining(expiresAt);
  assert.ok(result >= 99 && result <= 100);
});

test("pairingSecondsRemaining always returns non-negative integer", () => {
  const expiresAt = Date.now() + 500;
  const result = pairingSecondsRemaining(expiresAt, Date.now());
  assert.ok(Number.isInteger(result));
  assert.ok(result >= 0);
});

test("formatRelativeTime returns empty for missing timestamp", () => {
  assert.strictEqual(formatRelativeTime(null), "");
  assert.strictEqual(formatRelativeTime(undefined), "");
  assert.strictEqual(formatRelativeTime(Number.NaN), "");
});

test("formatRelativeTime returns 'ara mateix' for recent timestamps", () => {
  const now = 1_000_000;
  assert.strictEqual(formatRelativeTime(now - 30_000, now), "ara mateix");
  assert.strictEqual(formatRelativeTime(now - 59_000, now), "ara mateix");
});

test("formatRelativeTime formats minutes and hours", () => {
  const now = 20_000_000;
  assert.strictEqual(formatRelativeTime(now - 90_000, now), "fa 1 min");
  assert.strictEqual(formatRelativeTime(now - 2_000_000, now), "fa 33 min");
  assert.strictEqual(formatRelativeTime(now - 4_000_000, now), "fa 1 h");
  assert.strictEqual(formatRelativeTime(now - 10_000_000, now), "fa 2 h");
});

test("formatRelativeTime formats 'ahir' and older dates", () => {
  const now = 1_000_000_000;
  assert.strictEqual(formatRelativeTime(now - 100_000_000, now), "ahir");
  assert.strictEqual(formatRelativeTime(now - 400_000_000, now), "fa 4 dies");
});

test("cloudUsernameStatus stays empty outside the register tab", () => {
  assert.deepEqual(
    cloudUsernameStatus({
      tab: "login",
      checking: true,
      available: true,
      error: "x",
    }),
    { tone: "idle", label: "", hint: "" },
  );
});

test("cloudUsernameStatus shows progress, success, and failure states", () => {
  assert.deepEqual(
    cloudUsernameStatus({
      tab: "register",
      checking: true,
      available: null,
      error: "",
    }),
    { tone: "checking", label: "Comprovant…", hint: "" },
  );
  assert.deepEqual(
    cloudUsernameStatus({
      tab: "register",
      checking: false,
      available: true,
      error: "",
    }),
    {
      tone: "available",
      label: "✓ Disponible",
      hint: "El nom d'usuari està lliure.",
    },
  );
  assert.deepEqual(
    cloudUsernameStatus({
      tab: "register",
      checking: false,
      available: false,
      error: "",
    }),
    {
      tone: "taken",
      label: "✕ No disponible",
      hint: "Aquest nom d'usuari ja existeix. Tria'n un altre.",
    },
  );
  assert.deepEqual(
    cloudUsernameStatus({
      tab: "register",
      checking: false,
      available: null,
      error: "sense xarxa",
    }),
    { tone: "error", label: "No verificat", hint: "sense xarxa" },
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import { mapVaultEntry, pairingSecondsRemaining } from "./utils.js";

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

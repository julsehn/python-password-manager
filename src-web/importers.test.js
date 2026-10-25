import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeImportedEntries,
  normalizeImportedFolders,
  parseCsv,
} from "./importers.js";

test("parseCsv preserves quoted delimiters and multiline values", () => {
  const records = parseCsv(
    'name;username;password;notes\r\n"Work; email";alice;secret;"line 1\nline 2"',
  );

  assert.deepEqual(records, [
    {
      name: "Work; email",
      username: "alice",
      password: "secret",
      notes: "line 1\nline 2",
    },
  ]);
});

test("normalizeImportedEntries supports nested login exports and bounds invalid data", () => {
  const result = normalizeImportedEntries([
    {
      id: "entry-1",
      login: {
        username: "alice",
        password: "secret",
        uris: [{ uri: "https://example.test" }],
      },
      notes: "personal",
    },
    { username: "no password" },
    null,
  ]);

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].site, "https://example.test");
  assert.equal(result.entries[0].notes, "URL: https://example.test\npersonal");
  assert.equal(result.skipped, 2);
});

test("normalizeImportedFolders rejects duplicates and invalid presentation values", () => {
  const folders = normalizeImportedFolders(
    [
      { id: "1", name: "Work", icon: "NotAnIcon", color: "#fff" },
      { id: "1", name: "Duplicate", icon: "Folder", color: "#2471d1" },
    ],
    ["Folder"],
    ["#2471d1"],
  );

  assert.deepEqual(folders, [
    { id: "1", name: "Work", icon: "Folder", color: "#2471d1" },
  ]);
});

test("parseCsv rejects unclosed quotes", () => {
  assert.throws(
    () => parseCsv('site,password\nexample,"secret'),
    /cometes sense tancar/,
  );
});

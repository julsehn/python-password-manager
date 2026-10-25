function readImportValue(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && (character === "," || character === ";")) {
      row.push(field);
      field = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  if (quoted) throw new Error("El CSV conté cometes sense tancar.");
  if (rows.length < 2) {
    throw new Error("El CSV no conté cap accés per importar.");
  }

  const headers = rows.shift().map((header) =>
    header
      .trim()
      .replace(/^\uFEFF/, "")
      .toLowerCase(),
  );
  return rows.map((values) =>
    Object.fromEntries(
      headers.map((header, index) => [header, values[index] || ""]),
    ),
  );
}

export function normalizeImportedEntries(records) {
  if (!Array.isArray(records) || records.length > 10_000) {
    throw new Error("El fitxer supera el límit de 10.000 accessos.");
  }

  const now = new Date().toISOString();
  const ids = new Set();
  let skipped = 0;
  const entries = records.flatMap((record) => {
    if (!record || typeof record !== "object") {
      skipped += 1;
      return [];
    }
    const login =
      record.login && typeof record.login === "object" ? record.login : {};
    const url = (
      readImportValue(record, ["url", "website", "uri", "formactionorigin"]) ||
      readImportValue(login, ["uri", "url"]) ||
      String(login.uris?.[0]?.uri || "")
    ).trim();
    const password =
      readImportValue(record, ["password", "pass"]) ||
      readImportValue(login, ["password"]);
    const site = (
      readImportValue(record, ["site", "name", "title"]) ||
      url ||
      "Accés importat"
    ).trim();
    const username =
      readImportValue(record, ["username", "user", "email", "login"]) ||
      readImportValue(login, ["username"]);
    const notes = readImportValue(record, ["notes", "note"]);
    const savedNotes = url ? `URL: ${url}${notes ? `\n${notes}` : ""}` : notes;

    if (
      !password ||
      site.length > 4_096 ||
      username.length > 4_096 ||
      password.length > 16_384 ||
      savedNotes.length > 32_768 ||
      url.length > 4_000
    ) {
      skipped += 1;
      return [];
    }

    let id = readImportValue(record, ["id"]).trim();
    if (!id || ids.has(id)) id = crypto.randomUUID();
    ids.add(id);
    return [
      {
        id,
        site,
        username,
        password,
        notes: savedNotes,
        folderId: readImportValue(record, ["folderId", "folderid"]),
        createdAt: readImportValue(record, ["createdat"]) || now,
        updatedAt: readImportValue(record, ["updatedat"]) || now,
      },
    ];
  });

  if (!entries.length) {
    throw new Error("No s'ha trobat cap accés vàlid al fitxer.");
  }
  return { entries, skipped };
}

export function normalizeImportedFolders(folders, folderIcons, folderColors) {
  if (!Array.isArray(folders)) return [];
  const ids = new Set();
  return folders
    .flatMap((folder) => {
      const id = String(folder?.id || "").trim();
      const name = String(folder?.name || "").trim();
      if (!id || !name || ids.has(id) || name.length > 80) return [];
      ids.add(id);
      return [
        {
          id,
          name,
          icon: folderIcons.includes(folder.icon) ? folder.icon : "Folder",
          color: folderColors.includes(folder.color)
            ? folder.color
            : folderColors[0],
        },
      ];
    })
    .slice(0, 100);
}

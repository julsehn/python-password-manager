/**
 * SherLock - Password & Passphrase Generator
 * Secure cryptographically-random password, passphrase, and username generation.
 */

import { escapeHtml } from "./utils.js";
import { DICEWARE_USERNAME_WORDLISTS } from "./wordlist-diceware.js";
import { EFF_WORDLIST } from "./wordlist-eff.js";

// Short fallback lists for languages without a bundled Diceware wordlist.
// Catalan and Spanish usernames are generated from wordlist-diceware.js.
const fallbackWordsByLanguage = {
  Anglès: [
    "cloud",
    "river",
    "light",
    "forest",
    "moon",
    "wind",
    "fire",
    "path",
    "star",
    "meadow",
  ],
  English: [
    "cloud",
    "river",
    "light",
    "forest",
    "moon",
    "wind",
    "fire",
    "path",
    "star",
    "meadow",
  ],
  Francès: [
    "nuage",
    "rivière",
    "lumière",
    "forêt",
    "lune",
    "vent",
    "feu",
    "chemin",
    "étoile",
    "prairie",
  ],
  Français: [
    "nuage",
    "rivière",
    "lumière",
    "forêt",
    "lune",
    "vent",
    "feu",
    "chemin",
    "étoile",
    "prairie",
  ],
};

const USERNAME_LANGUAGE_ALIASES = {
  Català: "Català",
  Castellà: "Castellà",
  Español: "Castellà",
  Anglès: "Anglès",
  English: "Anglès",
  Francès: "Francès",
  Français: "Francès",
};

export const USERNAME_FORMATS = Object.freeze([
  { id: "word", label: "Paraula aleatòria" },
  { id: "two-words", label: "Dues paraules" },
  { id: "alias", label: "Àlies amb números" },
]);

export function secureRandomIndex(max) {
  if (!Number.isSafeInteger(max) || max < 1)
    throw new Error("Límit aleatori no vàlid.");
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const values = new Uint32Array(1);
  do {
    crypto.getRandomValues(values);
  } while (values[0] >= limit);
  return values[0] % max;
}

export function randomItem(items) {
  return items[secureRandomIndex(items.length)];
}

export function withoutAccents(word) {
  return word.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function canonicalUsernameLanguage(language) {
  return USERNAME_LANGUAGE_ALIASES[language] || "Català";
}

export function usernameFormatId(value) {
  return USERNAME_FORMATS.some(({ id }) => id === value) ? value : "word";
}

const usernamePoolCache = new Map();

export function usernameWordPool(language = "Català", options = {}) {
  const canonical = canonicalUsernameLanguage(language);
  const onlyUnaccented = options.onlyUnaccented === true;
  const removeAccents = options.removeAccents === true;
  const cacheKey = `${canonical}\u0000${onlyUnaccented}\u0000${removeAccents}`;
  const cached = usernamePoolCache.get(cacheKey);
  if (cached) return cached;

  const base =
    DICEWARE_USERNAME_WORDLISTS[canonical] ||
    fallbackWordsByLanguage[canonical] ||
    fallbackWordsByLanguage.Anglès;
  const available = onlyUnaccented
    ? base.filter((word) => word === withoutAccents(word))
    : base;
  const words = removeAccents
    ? available.map((word) => withoutAccents(word))
    : available;
  const pool = Object.freeze([...new Set(words)]);
  usernamePoolCache.set(cacheKey, pool);
  return pool;
}

export function generatorWords(language = "Català", onlyUnaccented = false) {
  return [...usernameWordPool(language, { onlyUnaccented })];
}

export function formatGeneratorWord(word, removeAccents = false) {
  return removeAccents ? withoutAccents(word) : word;
}

export function passphraseEntropyBits(
  wordCount,
  poolSize = EFF_WORDLIST.length,
  { withNumber = false } = {},
) {
  // Words are sampled without replacement, so each draw has one fewer option.
  let bits = 0;
  for (let index = 0; index < wordCount && index < poolSize; index += 1) {
    bits += Math.log2(poolSize - index);
  }
  return withNumber ? bits + Math.log2(10) : bits;
}

export function sampleWordsWithoutReplacement(
  pool,
  count,
  randomIndex = secureRandomIndex,
) {
  const available = [...pool];
  const picked = [];
  const total = Math.min(count, available.length);
  for (let index = 0; index < total; index += 1) {
    const pick = randomIndex(available.length);
    picked.push(available.splice(pick, 1)[0]);
  }
  return picked;
}

export function generateUsername(options = {}, language = "Català") {
  const format = usernameFormatId(options.usernameFormat);
  const wordCount = format === "two-words" ? 2 : 1;
  const pool = usernameWordPool(language, options);
  const words = sampleWordsWithoutReplacement(pool, wordCount).map((word) =>
    options.uppercaseInitial === true
      ? word.charAt(0).toUpperCase() + word.slice(1)
      : word,
  );
  let value = words.join(format === "two-words" ? "-" : "");
  if (format === "alias" || options.includeNumber) {
    value += String(secureRandomIndex(90) + 10);
  }
  return value;
}

export const MASTER_PASSWORD_MIN_LENGTH = 12;

const MASTER_PASSWORD_REQUIREMENTS = [
  {
    id: "length",
    label: `Un mínim de ${MASTER_PASSWORD_MIN_LENGTH} caràcters`,
    test: (password) => [...password].length >= MASTER_PASSWORD_MIN_LENGTH,
  },
  {
    id: "uppercase",
    label: "Una majúscula (A-Z)",
    test: (password) => /[A-Z]/.test(password),
  },
  {
    id: "lowercase",
    label: "Una minúscula (a-z)",
    test: (password) => /[a-z]/.test(password),
  },
  {
    id: "number",
    label: "Un número (0-9)",
    test: (password) => /\d/.test(password),
  },
  {
    id: "symbol",
    label: "Un caràcter especial (!@#$%…)",
    test: (password) => /[^A-Za-z0-9\s]/.test(password),
  },
];

export function passwordRequirements(password) {
  const value = String(password ?? "");
  return MASTER_PASSWORD_REQUIREMENTS.map(({ id, label, test }) => ({
    id,
    label,
    met: test(value),
  }));
}

export function passwordMeetsRequirements(password) {
  return passwordRequirements(password).every((requirement) => requirement.met);
}

export function passwordRequirementsMarkup(password = "") {
  return `
    <p class="requirements-title">La contrasenya mestra ha de complir:</p>
    <ul class="password-requirements" data-password-requirements aria-label="Requisits de la contrasenya mestra">
      ${passwordRequirements(password)
        .map(
          (requirement) =>
            `<li data-requirement="${requirement.id}" class="${requirement.met ? "is-met" : ""}">${requirement.label}</li>`,
        )
        .join("")}
    </ul>
  `;
}

export function passwordStrengthMarkup(password = "") {
  const strength = passwordStrength(password);
  return `
    <div class="password-strength" data-password-strength ${password ? "" : "hidden"}>
      <div class="strength-label">
        <span>Força de la contrasenya</span>
        <strong class="strength-${strength.level}">${strength.label}</strong>
      </div>
      <div class="strength-track">
        <span class="strength-fill strength-${strength.level} strength-width-${strength.percent}"></span>
      </div>
      <small>${strength.hint}</small>
    </div>
  `;
}

export function passwordStrength(password) {
  const length = [...password].length;
  let score = 0;
  if (length >= MASTER_PASSWORD_MIN_LENGTH) score++;
  if (length >= 20) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9\s]/.test(password)) score++;
  const levels = [
    {
      level: "weak",
      label: "Feble",
      hint: "Afegeix longitud i varietat de caràcters.",
      percent: 20,
    },
    {
      level: "fair",
      label: "Acceptable",
      hint: "Millorable amb més longitud o símbols.",
      percent: 45,
    },
    {
      level: "good",
      label: "Bona",
      hint: "Una contrasenya raonablement resistent.",
      percent: 70,
    },
    {
      level: "strong",
      label: "Molt forta",
      hint: "Bona combinació de longitud i varietat.",
      percent: 100,
    },
  ];
  return levels[Math.min(levels.length - 1, Math.max(0, score - 1))];
}

export function passphraseWordPool(options, language = "Català") {
  const seen = new Set();
  const words = generatorWords(language, options.onlyUnaccented);
  return words.reduce((pool, word) => {
    const formatted = formatGeneratorWord(word, options.removeAccents);
    const displayWord =
      options.uppercaseWords === false
        ? formatted
        : formatted.charAt(0).toUpperCase() + formatted.slice(1);
    const key = displayWord.normalize("NFC").toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      pool.push(displayWord);
    }
    return pool;
  }, []);
}

export function generateValue(type, options, language = "Català") {
  if (type === "password") {
    const characterSets = [
      options.uppercase && "ABCDEFGHJKLMNPQRSTUVWXYZ",
      options.lowercase && "abcdefghijkmnopqrstuvwxyz",
      options.numbers && "23456789",
      options.symbols && "!@#$%^&*",
    ].filter(Boolean);
    const sets = characterSets.length
      ? characterSets
      : ["abcdefghijkmnopqrstuvwxyz"];
    const alphabet = sets.join("");
    const characters = sets.map((set) => set[secureRandomIndex(set.length)]);
    while (characters.length < options.length) {
      characters.push(alphabet[secureRandomIndex(alphabet.length)]);
    }
    for (let index = characters.length - 1; index > 0; index -= 1) {
      const swapIndex = secureRandomIndex(index + 1);
      [characters[index], characters[swapIndex]] = [
        characters[swapIndex],
        characters[index],
      ];
    }
    return characters.join("");
  }
  if (type === "passphrase") {
    const wordCount = Math.min(12, Math.max(5, Number(options.words) || 6));
    options.words = wordCount;
    const words = sampleWordsWithoutReplacement(EFF_WORDLIST, wordCount);
    const value = words.join(options.separator);
    return options.includeNumber ? `${value}${secureRandomIndex(10)}` : value;
  }
  return generateUsername(options, language);
}

export function passwordOptions(options) {
  return `
    <label class="range-label">
      Longitud <output id="generator-length-value">${options.length}</output>
      <input
        id="generator-length"
        type="range"
        min="8"
        max="128"
        value="${options.length}"
      />
    </label>
    <div class="check-grid">
      <label>
        <input data-option="uppercase" type="checkbox" ${options.uppercase ? "checked" : ""} />
        A-Z
      </label>
      <label>
        <input data-option="lowercase" type="checkbox" ${options.lowercase ? "checked" : ""} />
        a-z
      </label>
      <label>
        <input data-option="numbers" type="checkbox" ${options.numbers ? "checked" : ""} />
        0-9
      </label>
      <label>
        <input data-option="symbols" type="checkbox" ${options.symbols ? "checked" : ""} />
        !@#$%&*
      </label>
    </div>
  `;
}

export function passphraseOptions(options, language = "Català") {
  const minWords = 5;
  const maxWords = 12;
  const wordCount = Math.min(
    maxWords,
    Math.max(minWords, Number(options.words) || 6),
  );
  return `
    <label>
      Nombre de paraules
      <input id="generator-words" type="number" min="5" max="${maxWords}" value="${wordCount}" />
    </label>
    <label>
      Separador
      <input id="generator-separator" value="${escapeHtml(options.separator)}" maxlength="3" />
    </label>
    <label class="check-label">
      <input data-option="uppercaseWords" type="checkbox" ${options.uppercaseWords !== false ? "checked" : ""} />
      Majúscules inicials
    </label>
    <label class="check-label">
      <input data-option="includeNumber" type="checkbox" ${options.includeNumber ? "checked" : ""} />
      Inclou número
    </label>
    <label class="check-label">
      <input data-option="removeAccents" type="checkbox" ${options.removeAccents ? "checked" : ""} />
      Treure accents
    </label>
    <label class="check-label">
      <input data-option="onlyUnaccented" type="checkbox" ${options.onlyUnaccented ? "checked" : ""} />
      Només paraules sense accents
    </label>
    <small class="helper">Les paraules s'escullen de la llista EFF (anglès) sense repetir-se.</small>
  `;
}

export function usernameOptions(options) {
  const format = usernameFormatId(options.usernameFormat);
  const alias = format === "alias";
  return `
    <label>
      Format
      <select id="username-format">
        ${USERNAME_FORMATS.map(
          ({ id, label }) =>
            `<option value="${id}" ${format === id ? "selected" : ""}>${label}</option>`,
        ).join("")}
      </select>
    </label>
    <label class="check-label">
      <input data-option="uppercaseInitial" type="checkbox" ${options.uppercaseInitial === true ? "checked" : ""} />
      Majúscules inicials
    </label>
    <label class="check-label">
      <input data-option="includeNumber" type="checkbox" ${options.includeNumber || alias ? "checked" : ""} ${alias ? "disabled" : ""} />
      Inclou número${alias ? " (sempre a l'àlies)" : ""}
    </label>
    <label class="check-label">
      <input data-option="removeAccents" type="checkbox" ${options.removeAccents ? "checked" : ""} />
      Treure accents
    </label>
    <label class="check-label">
      <input data-option="onlyUnaccented" type="checkbox" ${options.onlyUnaccented ? "checked" : ""} />
      Només paraules sense accents
    </label>
    <small class="helper">Català i castellà: paraules de llistes Diceware, sense repetir-se.</small>
  `;
}

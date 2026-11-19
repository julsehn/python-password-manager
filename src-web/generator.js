/**
 * SherLock - Password & Passphrase Generator
 * Secure cryptographically-random password, passphrase, and username generation.
 */

import { escapeHtml } from "./utils.js";
import { EFF_WORDLIST } from "./wordlist-eff.js";

export const wordsByLanguage = {
  Català: [
    "núvol",
    "riu",
    "llum",
    "bosc",
    "mar",
    "lluna",
    "vent",
    "foc",
    "camí",
    "estrella",
  ],
  Castellà: [
    "nube",
    "rio",
    "luz",
    "bosque",
    "mar",
    "luna",
    "viento",
    "fuego",
    "camino",
    "estrella",
  ],
  Español: [
    "nube",
    "rio",
    "luz",
    "bosque",
    "mar",
    "luna",
    "viento",
    "fuego",
    "camino",
    "estrella",
  ],
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

export function generatorWords(language = "Català", onlyUnaccented = false) {
  const words =
    wordsByLanguage[language] ||
    wordsByLanguage.Català ||
    wordsByLanguage.Anglès;
  const available = onlyUnaccented
    ? words.filter((word) => word === withoutAccents(word))
    : words;
  return available.length ? available : words;
}

export function formatGeneratorWord(word, removeAccents = false) {
  return removeAccents ? withoutAccents(word) : word;
}

export function passphraseEntropyBits(
  wordCount,
  poolSize = EFF_WORDLIST.length,
  { withNumber = false } = {},
) {
  const bits = wordCount * Math.log2(poolSize);
  return withNumber ? bits + Math.log2(10) : bits;
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
    const words = [];
    for (let index = 0; index < wordCount; index += 1) {
      words.push(EFF_WORDLIST[secureRandomIndex(EFF_WORDLIST.length)]);
    }
    const value = words.join(options.separator);
    return options.includeNumber ? `${value}${secureRandomIndex(10)}` : value;
  }
  const words = generatorWords(language, options.onlyUnaccented);
  const value = `${formatGeneratorWord(randomItem(words), options.removeAccents)}${formatGeneratorWord(randomItem(words), options.removeAccents)}`;
  return options.includeNumber ? `${value}${secureRandomIndex(100)}` : value;
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
    <small class="helper">Les paraules s'escollen de la llista EFF (anglès) i poden repetir-se.</small>
  `;
}

export function usernameOptions(options) {
  return `
    <label>
      Format
      <select id="username-format">
        <option>Paraula aleatòria</option>
        <option>Nom i cognom</option>
        <option>Àlies amb números</option>
      </select>
    </label>
    <label class="check-label">
      <input data-option="uppercaseInitial" type="checkbox" ${options.uppercaseInitial !== false ? "checked" : ""} />
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
  `;
}

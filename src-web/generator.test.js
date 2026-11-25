import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { DICEWARE_USERNAME_WORDLISTS } from "./wordlist-diceware.js";
import { EFF_WORDLIST } from "./wordlist-eff.js";
import {
  MASTER_PASSWORD_MIN_LENGTH,
  USERNAME_FORMATS,
  generateUsername,
  generateValue,
  GENERATOR_MAX_MIN_COUNT,
  generatorMinimumLength,
  passphraseEntropyBits,
  passwordMeetsRequirements,
  passwordOptions,
  passwordRequirements,
  passwordStrength,
  passphraseOptions,
  sampleWordsWithoutReplacement,
  usernameFormatId,
  usernameOptions,
  usernameWordPool,
  withoutAccents,
} from "./generator.js";

describe("EFF wordlist", () => {
  it("té exactament 7776 paraules", () => {
    assert.strictEqual(EFF_WORDLIST.length, 7776);
  });
  it("sense duplicats ni espais", () => {
    const seen = new Set();
    for (const word of EFF_WORDLIST) {
      assert.strictEqual(typeof word, "string");
      assert.ok(word.length > 0);
      assert.ok(!/\s/.test(word), `${word} conté espai`);
      assert.ok(!seen.has(word), `${word} està duplicat`);
      seen.add(word);
    }
  });
});

describe("passphraseEntropyBits", () => {
  it("6 paraules de 7776 ≈ 77.5 bits", () => {
    assert.ok(Math.abs(passphraseEntropyBits(6, 7776) - 77.5) < 0.1);
  });
  it("4 paraules de 10 sense reemplaçament ≈ 12.3 bits", () => {
    assert.ok(
      Math.abs(passphraseEntropyBits(4, 10, { withNumber: false }) - 12.3) <
        0.1,
    );
  });
  it("amb número suma log2(10)", () => {
    const base = passphraseEntropyBits(6, 7776);
    assert.ok(
      Math.abs(
        passphraseEntropyBits(6, 7776, { withNumber: true }) -
          (base + Math.log2(10)),
      ) < 0.001,
    );
  });
});

describe("sampleWordsWithoutReplacement", () => {
  it("no repeteix paraules encara que l'atzar sempre triï la primera", () => {
    const picked = sampleWordsWithoutReplacement(
      ["alba", "bosc", "cel", "duna"],
      4,
      () => 0,
    );
    assert.deepEqual(picked, ["alba", "bosc", "cel", "duna"]);
  });

  it("no demana més paraules de les disponibles", () => {
    const picked = sampleWordsWithoutReplacement(["a", "b"], 5, () => 0);
    assert.deepEqual(picked, ["a", "b"]);
  });
});

describe("passwordStrength", () => {
  it("keeps the existing labels and score thresholds", () => {
    assert.equal(passwordStrength("abc").level, "weak");
    assert.equal(passwordStrength("Abcdefgh1234").level, "good");
    assert.equal(passwordStrength("Abcdefghij1234!xyz").level, "strong");
  });
});

describe("master password requirements", () => {
  it("accepts a password with length and every character class", () => {
    assert.equal(MASTER_PASSWORD_MIN_LENGTH, 12);
    assert.equal(passwordMeetsRequirements("Abcdefghij1!x"), true);
    assert.deepEqual(
      passwordRequirements("Abcdefghij1!x").map(({ id, met }) => [id, met]),
      [
        ["length", true],
        ["uppercase", true],
        ["lowercase", true],
        ["number", true],
        ["symbol", true],
      ],
    );
  });

  it("rejects passwords below the minimum length", () => {
    assert.equal(passwordMeetsRequirements("Abcdefgh1!x"), false);
  });

  it("rejects every missing character class", () => {
    assert.equal(passwordMeetsRequirements("abcdefghij1!x"), false);
    assert.equal(passwordMeetsRequirements("ABCDEFGHIJ1!X"), false);
    assert.equal(passwordMeetsRequirements("Abcdefghijk!x"), false);
    assert.equal(passwordMeetsRequirements("Abcdefghij12x"), false);
  });

  it("does not count whitespace as a special character", () => {
    assert.equal(passwordMeetsRequirements("Abcdefghij1 "), false);
  });
});

describe("generateValue passphrase", () => {
  it("retorna 6 paraules catalanes separades per '-'", () => {
    const value = generateValue("passphrase", {
      words: 6,
      separator: "-",
      includeNumber: false,
    });
    const parts = value.split("-");
    assert.strictEqual(parts.length, 6);
    for (const part of parts) {
      assert.ok(
        DICEWARE_USERNAME_WORDLISTS.Català.includes(part.toLowerCase()),
        `${part} no és a la llista catalana`,
      );
    }
  });

  it("respecta l'idioma seleccionat (castellà i anglès)", () => {
    const spanish = generateValue(
      "passphrase",
      { words: 6, separator: "-", includeNumber: false },
      "Castellà",
    );
    for (const part of spanish.split("-")) {
      assert.ok(
        DICEWARE_USERNAME_WORDLISTS.Castellà.includes(part.toLowerCase()),
        `${part} no és a la llista castellana`,
      );
    }
    const english = generateValue(
      "passphrase",
      { words: 6, separator: "-", includeNumber: false },
      "Anglès",
    );
    for (const part of english.split("-")) {
      assert.ok(
        EFF_WORDLIST.includes(part.toLowerCase()),
        `${part} no és a la llista anglesa`,
      );
    }
  });

  it("respecte el nombre de paraules sol·licitat (dins del rang)", () => {
    const value6 = generateValue("passphrase", {
      words: 6,
      separator: " ",
      includeNumber: false,
    });
    assert.strictEqual(value6.split(" ").length, 6);
  });

  it("aplica mínim 5 i màxim 12 paraules", () => {
    const v5 = generateValue("passphrase", {
      words: 2,
      separator: " ",
      includeNumber: false,
    });
    assert.strictEqual(v5.split(" ").length, 5);
    const v12 = generateValue("passphrase", {
      words: 99,
      separator: " ",
      includeNumber: false,
    });
    assert.strictEqual(v12.split(" ").length, 12);
  });

  it("afegix un dígit quan includeNumber és true", () => {
    const value = generateValue("passphrase", {
      words: 5,
      separator: " ",
      includeNumber: true,
    });
    const parts = value.split(" ");
    assert.strictEqual(parts.length, 5);
    assert.ok(/\d$/.test(value), "l'últim caràcter ha de ser un número");
    for (const part of parts) {
      assert.ok(
        DICEWARE_USERNAME_WORDLISTS.Català.includes(
          part.replace(/\d+$/, "").toLowerCase(),
        ),
        `${part} no és a la llista catalana`,
      );
    }
  });
});

describe("passphraseOptions", () => {
  it("minim 5, maxim 12 i valor per defecte 6", () => {
    const html = passphraseOptions({
      words: 6,
      separator: "-",
      includeNumber: false,
    });
    assert.ok(html.includes('min="5"'));
    assert.ok(html.includes('max="12"'));
    assert.ok(html.includes('value="6"'));
  });
  it("el valor per defecte no és inferior a 5", () => {
    const html = passphraseOptions({
      words: 2,
      separator: "-",
      includeNumber: false,
    });
    assert.ok(html.includes('value="5"'));
  });
  it("el valor no supera 12", () => {
    const html = passphraseOptions({
      words: 99,
      separator: "-",
      includeNumber: false,
    });
    assert.ok(html.includes('value="12"'));
  });
  it("amaga les opcions d'accents quan l'idioma és anglès", () => {
    const english = passphraseOptions(
      { words: 6, separator: "-", includeNumber: false },
      "Anglès",
    );
    assert.ok(!english.includes("Treure accents"));
    assert.ok(!english.includes("Només paraules sense accents"));
    const catalan = passphraseOptions(
      { words: 6, separator: "-", includeNumber: false },
      "Català",
    );
    assert.ok(catalan.includes("Treure accents"));
    assert.ok(catalan.includes("Només paraules sense accents"));
  });

  it("explica que les paraules no es repeteixen i són de la llista de l'idioma", () => {
    const html = passphraseOptions({
      words: 6,
      separator: "-",
      includeNumber: false,
    });
    assert.ok(html.includes("llista de l'idioma seleccionat"));
    assert.ok(html.includes("sense repetir-se"));
    assert.ok(!html.includes("llista EFF"));
  });
});

describe("generateValue password", () => {
  const options = {
    length: 20,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
    minNumbers: 3,
    minSymbols: 2,
  };

  it("respects exact length and minimum numbers/symbols", () => {
    assert.equal(generatorMinimumLength(options), 7);
    for (let index = 0; index < 30; index += 1) {
      const value = generateValue("password", options);
      assert.equal([...value].length, 20);
      assert.ok(/[A-Z]/.test(value));
      assert.ok(/[a-z]/.test(value));
      assert.ok((value.match(/[0-9]/g) || []).length >= 3);
      assert.ok((value.match(/[^A-Za-z0-9]/g) || []).length >= 2);
    }
  });

  it("expands the length when the minimums do not fit", () => {
    const value = generateValue("password", {
      length: 8,
      uppercase: false,
      lowercase: true,
      numbers: true,
      symbols: true,
      minNumbers: 5,
      minSymbols: 5,
    });
    assert.equal(
      generatorMinimumLength({
        uppercase: false,
        lowercase: true,
        numbers: true,
        symbols: true,
        minNumbers: 5,
        minSymbols: 5,
      }),
      11,
    );
    assert.equal([...value].length, 11);
    assert.ok((value.match(/[0-9]/g) || []).length >= 5);
    assert.ok((value.match(/[^A-Za-z0-9]/g) || []).length >= 5);
  });
});

describe("passwordOptions", () => {
  it("minim de longitud 8 (ja no 5)", () => {
    const html = passwordOptions({
      length: 20,
      uppercase: true,
      lowercase: true,
      numbers: true,
      symbols: true,
    });
    assert.ok(html.includes('min="8"'));
    assert.ok(!html.includes('min="5"'));
    assert.ok(html.includes('id="generator-length-input"'));
    assert.ok(html.includes('id="generator-min-numbers"'));
    assert.ok(html.includes('id="generator-min-symbols"'));
  });

  it("els mínims per defecte de números i símbols són 2", () => {
    const options = {
      length: 20,
      uppercase: true,
      lowercase: true,
      numbers: true,
      symbols: true,
    };
    const html = passwordOptions(options);
    assert.ok(
      html.includes(
        `id="generator-min-numbers" type="number" min="0" max="${GENERATOR_MAX_MIN_COUNT}" value="2"`,
      ),
    );
    assert.ok(
      html.includes(
        `id="generator-min-symbols" type="number" min="0" max="${GENERATOR_MAX_MIN_COUNT}" value="2"`,
      ),
    );
    assert.equal(generatorMinimumLength(options), 6);
    for (let index = 0; index < 30; index += 1) {
      const value = generateValue("password", options);
      assert.ok((value.match(/[0-9]/g) || []).length >= 2);
      assert.ok((value.match(/[^A-Za-z0-9]/g) || []).length >= 2);
    }
  });
});

describe("Diceware username wordlists", () => {
  for (const language of ["Català", "Castellà"]) {
    it(`la llista de ${language} és àmplia, única i apta per a usernames`, () => {
      const list = DICEWARE_USERNAME_WORDLISTS[language];
      assert.ok(list.length >= 4000, `${language} només té ${list.length}`);
      const seen = new Set();
      for (const word of list) {
        assert.match(word, /^\p{L}{3,16}$/u, `paraula no vàlida: ${word}`);
        assert.equal(word, word.toLowerCase());
        assert.ok(!seen.has(word), `${word} està duplicat`);
        seen.add(word);
      }
    });
  }

  it("el català conserva accents i el castellà ja és ASCII", () => {
    assert.ok(
      DICEWARE_USERNAME_WORDLISTS.Català.some(
        (word) => word !== withoutAccents(word),
      ),
      "el català no té cap paraula accentuada",
    );
    assert.ok(
      DICEWARE_USERNAME_WORDLISTS.Castellà.every(
        (word) => word === withoutAccents(word),
      ),
      "el castellà hauria de ser ASCII",
    );
  });

  it("onlyUnaccented elimina les paraules amb accents", () => {
    const pool = usernameWordPool("Català", { onlyUnaccented: true });
    assert.ok(pool.length > 1000);
    for (const word of pool) assert.equal(word, withoutAccents(word));
  });

  it("removeAccents deixa el pool en ASCII i sense duplicats", () => {
    const pool = usernameWordPool("Català", { removeAccents: true });
    assert.ok(pool.length > 1000);
    assert.equal(new Set(pool).size, pool.length);
    for (const word of pool) {
      assert.match(word, /^[a-z]+$/);
    }
  });

  it("el pool és immutable i els àlies d'idioma apunten a la mateixa llista", () => {
    const catalan = usernameWordPool("Català");
    assert.ok(Object.isFrozen(catalan));
    assert.deepEqual(usernameWordPool("Español"), usernameWordPool("Castellà"));
  });

  it("un idioma desconegut cau al català", () => {
    assert.deepEqual(usernameWordPool("Klingon"), usernameWordPool("Català"));
  });
});

describe("generateUsername", () => {
  const catalanPool = new Set(usernameWordPool("Català"));
  const spanishPool = new Set(usernameWordPool("Castellà"));

  it("el format paraula retorna una sola paraula del diccionari", () => {
    const value = generateUsername({ usernameFormat: "word" }, "Català");
    assert.ok(catalanPool.has(value), `${value} no és al diccionari català`);
  });

  it("el format dues paraules uneix dues paraules diferents amb '-'", () => {
    const value = generateUsername({ usernameFormat: "two-words" }, "Català");
    const parts = value.split("-");
    assert.equal(parts.length, 2);
    assert.notEqual(parts[0], parts[1]);
    for (const part of parts) assert.ok(catalanPool.has(part));
  });

  it("l'àlies amb números acaba sempre en dos dígits", () => {
    const value = generateUsername({ usernameFormat: "alias" }, "Castellà");
    assert.match(value, /^\p{L}+\d{2}$/u);
    assert.ok(spanishPool.has(value.replace(/\d+$/, "")));
  });

  it("inclou número opcional després de la paraula", () => {
    const value = generateUsername(
      { usernameFormat: "word", includeNumber: true },
      "Català",
    );
    assert.match(value, /\d{2}$/);
    assert.ok(catalanPool.has(value.slice(0, -2)));
  });

  it("aplica majúscules inicials a cada paraula", () => {
    const value = generateUsername(
      {
        usernameFormat: "two-words",
        uppercaseInitial: true,
        removeAccents: true,
      },
      "Català",
    );
    for (const part of value.split("-")) assert.match(part, /^\p{Lu}/u);
  });

  it("treu accents quan es demana", () => {
    const pool = new Set(usernameWordPool("Català", { removeAccents: true }));
    for (let index = 0; index < 25; index += 1) {
      const value = generateUsername(
        { usernameFormat: "word", removeAccents: true },
        "Català",
      );
      assert.match(value, /^[a-z]+$/);
      assert.ok(pool.has(value));
    }
  });

  it("generateValue amb tipus username respecta el format", () => {
    const value = generateValue(
      "username",
      { usernameFormat: "alias" },
      "Castellà",
    );
    assert.match(value, /\d{2}$/);
  });
});

describe("usernameOptions", () => {
  it("inclou els tres formats i marca el seleccionat", () => {
    assert.deepEqual(
      USERNAME_FORMATS.map(({ id }) => id),
      ["word", "two-words", "alias"],
    );
    const html = usernameOptions({
      usernameFormat: "two-words",
      uppercaseInitial: false,
    });
    assert.ok(html.includes('value="word"'));
    assert.ok(html.includes('value="two-words" selected'));
    assert.ok(html.includes('value="alias"'));
    assert.ok(html.includes("Diceware"));
  });

  it("desactiva el número a l'àlies perquè sempre n'afegeix", () => {
    const html = usernameOptions({ usernameFormat: "alias" });
    assert.ok(html.includes("disabled"));
    assert.ok(html.includes("sempre a l'àlies"));
  });

  it("cau al format paraula si el valor no és vàlid", () => {
    assert.equal(usernameFormatId("nope"), "word");
    assert.ok(
      usernameOptions({ usernameFormat: "nope" }).includes(
        'value="word" selected',
      ),
    );
  });
});

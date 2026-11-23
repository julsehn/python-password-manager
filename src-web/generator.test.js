import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { EFF_WORDLIST } from "./wordlist-eff.js";
import {
  MASTER_PASSWORD_MIN_LENGTH,
  passphraseEntropyBits,
  generateValue,
  passwordMeetsRequirements,
  passwordOptions,
  passwordRequirements,
  passwordStrength,
  passphraseOptions,
  sampleWordsWithoutReplacement,
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
  it("retorna 6 paraules separades per '-' de la llista EFF", () => {
    const value = generateValue("passphrase", {
      words: 6,
      separator: "-",
      includeNumber: false,
    });
    const parts = value.split("-");
    assert.strictEqual(parts.length, 6);
    for (const part of parts) {
      assert.ok(EFF_WORDLIST.includes(part), `${part} no esta a la llista EFF`);
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
    for (const part of parts.slice(0, -1)) {
      assert.ok(
        EFF_WORDLIST.includes(part.replace(/\d+$/, "")),
        `${part} no esta a la llista EFF`,
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
  it("explica que les paraules no es repeteixen i són de la llista EFF en anglès", () => {
    const html = passphraseOptions({
      words: 6,
      separator: "-",
      includeNumber: false,
    });
    assert.ok(html.includes("llista EFF"));
    assert.ok(html.includes("sense repetir-se"));
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
  });
});

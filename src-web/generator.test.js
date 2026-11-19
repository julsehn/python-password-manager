import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { EFF_WORDLIST } from "./wordlist-eff.js";
import {
  passphraseEntropyBits,
  generateValue,
  passwordOptions,
  passphraseOptions,
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
  it("4 paraules de 10 amb reemplaçament ≈ 13.3 bits", () => {
    assert.ok(
      Math.abs(passphraseEntropyBits(4, 10, { withNumber: false }) - 13.3) <
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
  it("mentí que les paraules poden repetir-se i que són de la llista EFF en anglès", () => {
    const html = passphraseOptions({
      words: 6,
      separator: "-",
      includeNumber: false,
    });
    assert.ok(html.includes("llista EFF"));
    assert.ok(html.includes("poden repetir-se"));
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

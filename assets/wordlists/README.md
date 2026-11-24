# Wordlists

## `eff_large_wordlist.txt`

EFF Large Wordlist used by the passphrase generator. Generated artifact:
`src-web/wordlist-eff.js` (via `tools/build_wordlist.mjs`).

- Source: https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt
- Author: Electronic Frontier Foundation (EFF)
- License: CC BY 3.0 US (https://creativecommons.org/licenses/by/3.0/us/)

## `diceware_ca.txt` and `diceware_es.txt`

Diceware lists used by the username generator for Catalan and Spanish. They are
the decoded arrays from webpassgen's `lists/dicewareCA.js` and
`lists/dicewareES.js`, one entry per line, unchanged. Generated artifact:
`src-web/wordlist-diceware.js` (via `tools/build_diceware_wordlists.mjs`).

- Source: https://github.com/atoponce/webpassgen
- Upstream: Diceware wordlists (https://www.diceware.com/)
- License: webpassgen is AGPL-3.0; the wordlist data keeps its upstream terms.

The build tool keeps only entries that are already lowercase, drops entries
shorter than 3 or longer than 16 characters, and removes duplicates. Do not
edit the generated files by hand.

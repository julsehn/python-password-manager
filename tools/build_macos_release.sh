#!/bin/sh
set -eu

: "${APPLE_SIGNING_IDENTITY:?Set APPLE_SIGNING_IDENTITY to a Developer ID Application identity}"
: "${APPLE_API_ISSUER:?Set APPLE_API_ISSUER for notarization}"
: "${APPLE_API_KEY:?Set APPLE_API_KEY for notarization}"
: "${APPLE_API_KEY_PATH:?Set APPLE_API_KEY_PATH for notarization}"

if [ ! -f "$APPLE_API_KEY_PATH" ]; then
  printf '%s\n' "Apple notarization key file not found."
  exit 1
fi

if ! security find-identity -v -p codesigning | grep -F -- "$APPLE_SIGNING_IDENTITY" >/dev/null; then
  printf '%s\n' "The configured Apple signing identity is not installed in this keychain."
  exit 1
fi

npm run tauri -- build --bundles app,dmg
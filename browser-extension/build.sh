#!/bin/bash
# build.sh – Build Caixa Forta browser extension for Chrome and Firefox.
#
# ⚠️  Firefox note (F2b): If you loaded build/firefox as a Temporary Add-on in
#    Firefox (about:debugging), rebuilding deletes and recreates that folder.
#    Firefox keeps serving the stale code until you manually reload the add-on
#    (click Reload in about:debugging), and Temporary Add-ons disappear on
#    Firefox restart.  Use a permanent signed XPI for a stable test setup, or
#    reload after every build.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Building Caixa Forta Browser Extension…"

# Warn if Firefox has the build/firefox directory loaded as a temporary add-on.
if [ -d "build/firefox" ]; then
  echo "⚠️  build/firefox exists and will be recreated."
  echo "   If you loaded it as a Temporary Add-on in Firefox, reload it in"
  echo "   about:debugging after this build completes."
fi

rm -rf build/chrome build/firefox
mkdir -p build/chrome build/firefox

copy_common_files() {
	local target="$1"
	mkdir -p "$target/native"
	cp native/caixa_forta_native.py "$target/native/"
	cp -R icons popup.html popup.js content.js content.css background.js "$target/"
}

copy_common_files build/chrome
cp manifest.chrome.json build/chrome/manifest.json
copy_common_files build/firefox
cp manifest.firefox.json build/firefox/manifest.json

echo "Creating Chrome extension archive…"
cd build/chrome
zip -qr ../caixa-forta-chrome-extension.zip .
cd ../..

echo "Creating Firefox extension archive…"
cd build/firefox
zip -qr ../caixa-forta-firefox-extension.zip .
cd ../..

echo ""
echo "✅ Build complete!"
echo "   Chrome:  browser-extension/build/chrome/  (load as unpacked extension)"
echo "   Firefox: browser-extension/build/firefox/ (load as Temporary Add-on)"
echo "   Zips in: browser-extension/build/"
echo ""
echo "   Chrome extension ID (from manifest key): lcbgmkafanopplcefoapdfmhhjfoaamd"
echo "   Firefox add-on ID (from gecko.id):        caixa-forta@juls.com"

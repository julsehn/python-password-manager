#!/bin/bash
set -euo pipefail

# Build script for Caixa Forta browser extension

echo "Building Caixa Forta Browser Extension..."

# Create build directory
mkdir -p build/chrome build/firefox

rm -rf build/chrome/* build/firefox/*

copy_common_files() {
	local target="$1"
	cp -r icons popup.html content.js content.css background.js "$target/"
}

copy_common_files build/chrome
cp manifest.chrome.json build/chrome/manifest.json
copy_common_files build/firefox
cp manifest.firefox.json build/firefox/manifest.json

# Create packed extensions
echo "Creating Chrome extension archive..."
cd build/chrome
zip -qr ../caixa-forta-chrome-extension.zip .
cd ../..

echo "Creating Firefox extension archive..."
cd build/firefox
zip -qr ../caixa-forta-firefox-extension.zip .
cd ../..

echo "Build complete!"
echo "Extension files are in build/chrome and build/firefox directories"

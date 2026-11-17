#!/bin/sh
set -eu

# Directori base del projecte (python-password-manager)
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

# 1. Si s'ha actualitzat Untitled.icon a l'arrel, sincronitzar-lo
if [ -d "../Untitled.icon" ]; then
    printf '%s\n' "Sincronitzant Untitled.icon -> src-tauri/icons/AppIcon.icon i assets/icons/SherLock.icon..."
    rm -rf "src-tauri/icons/AppIcon.icon"
    cp -R "../Untitled.icon" "src-tauri/icons/AppIcon.icon"
    rm -rf "assets/icons/SherLock.icon"
    cp -R "../Untitled.icon" "assets/icons/SherLock.icon"
fi

# 2. Compilar Assets.car amb actool d'Xcode
printf '%s\n' "Compilant Assets.car amb actool d'Xcode..."
DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer" \
  xcrun actool src-tauri/icons/AppIcon.icon \
  --compile src-tauri/icons \
  --platform macosx \
  --minimum-deployment-target 11.0 \
  --output-format human-readable-text

# 3. Si s'especifica un PNG o es troba a 'Untitled Exports', actualitzar també .icns, .ico i .png
PNG_SRC="${1:-}"
if [ -z "$PNG_SRC" ]; then
    if [ -f "../Untitled Exports/Untitled-iOS-Default-1024@1x.png" ]; then
        PNG_SRC="../Untitled Exports/Untitled-iOS-Default-1024@1x.png"
    fi
fi

if [ -n "$PNG_SRC" ] && [ -f "$PNG_SRC" ]; then
    printf '%s\n' "Regenerant icones d'aplicació (.icns, .ico, .png) des de: $PNG_SRC..."
    npm run tauri -- icon "$PNG_SRC" >/dev/null 2>&1
    # Netejar icones mòbils innecessàries per a escriptori
    rm -rf src-tauri/icons/android src-tauri/icons/ios src-tauri/icons/Square*.png src-tauri/icons/StoreLogo.png
fi

# 4. Actualitzar les icones de l'extensió del navegador i marques públiques si existeix Untitled Exports
if [ -d "../Untitled Exports" ]; then
    printf '%s\n' "Actualitzant icones de l'extensió del navegador i de la interfície..."
    
    # Browser extension icons
    [ -f "../Untitled Exports/Untitled-iOS-Default-16@1x.png" ] && cp "../Untitled Exports/Untitled-iOS-Default-16@1x.png" "browser-extension/icons/icon16.png"
    [ -f "../Untitled Exports/Untitled-iOS-Default-128@1x.png" ] && sips -z 48 48 "../Untitled Exports/Untitled-iOS-Default-128@1x.png" --out "browser-extension/icons/icon48.png" >/dev/null 2>&1
    [ -f "../Untitled Exports/Untitled-iOS-Default-128@1x.png" ] && cp "../Untitled Exports/Untitled-iOS-Default-128@1x.png" "browser-extension/icons/icon128.png"
    [ -f "../Untitled Exports/Untitled-iOS-Dark-128@1x.png" ] && cp "../Untitled Exports/Untitled-iOS-Dark-128@1x.png" "browser-extension/icons/icon128-dark.png"
    [ -f "../Untitled Exports/Untitled-iOS-ClearDark-128@1x.png" ] && cp "../Untitled Exports/Untitled-iOS-ClearDark-128@1x.png" "browser-extension/icons/icon128-clear-dark.png"
    [ -f "../Untitled Exports/Untitled-iOS-ClearLight-128@1x.png" ] && cp "../Untitled Exports/Untitled-iOS-ClearLight-128@1x.png" "browser-extension/icons/icon128-clear-light.png"

    # Reconstruir paquets de l'extensió
    if [ -x "browser-extension/build.sh" ]; then
        (cd browser-extension && ./build.sh >/dev/null 2>&1)
    fi

    # Public brand icons per a la interfície d'escriptori
    [ -f "../Untitled Exports/Untitled-iOS-Default-1024@1x.png" ] && cp "../Untitled Exports/Untitled-iOS-Default-1024@1x.png" "public/brand/SherLock-brand.png"
    [ -f "../Untitled Exports/Untitled-iOS-Dark-1024@1x.png" ] && cp "../Untitled Exports/Untitled-iOS-Dark-1024@1x.png" "public/brand/SherLock-brand-dark.png"
    [ -f "../Untitled Exports/Untitled-iOS-ClearDark-1024@1x.png" ] && cp "../Untitled Exports/Untitled-iOS-ClearDark-1024@1x.png" "public/brand/SherLock-brand-clear-dark.png"
    [ -f "../Untitled Exports/Untitled-iOS-ClearLight-1024@1x.png" ] && cp "../Untitled Exports/Untitled-iOS-ClearLight-1024@1x.png" "public/brand/SherLock-brand-clear-light.png"

    # Assets icons backup
    [ -f "../Untitled Exports/Untitled-iOS-Default-1024@1x.png" ] && cp "../Untitled Exports/Untitled-iOS-Default-1024@1x.png" "assets/icons/SherLock-brand.png"
    [ -f "../Untitled Exports/Untitled-iOS-Default-1024@1x.png" ] && cp "../Untitled Exports/Untitled-iOS-Default-1024@1x.png" "assets/icons/appearances/SherLock-brand.png"
    [ -f "../Untitled Exports/Untitled-iOS-Dark-1024@1x.png" ] && cp "../Untitled Exports/Untitled-iOS-Dark-1024@1x.png" "assets/icons/appearances/SherLock-brand-dark.png"
    [ -f "../Untitled Exports/Untitled-iOS-ClearDark-1024@1x.png" ] && cp "../Untitled Exports/Untitled-iOS-ClearDark-1024@1x.png" "assets/icons/appearances/SherLock-brand-clear-dark.png"
    [ -f "../Untitled Exports/Untitled-iOS-ClearLight-1024@1x.png" ] && cp "../Untitled Exports/Untitled-iOS-ClearLight-1024@1x.png" "assets/icons/appearances/SherLock-brand-clear-light.png"
fi

printf '\n%s\n' "✅ Totes les icones (Tauri, extensió i interfície) s'han actualitzat correctament!"

#!/bin/sh
set -eu

# Directori base del projecte (python-password-manager)
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

# Font editable de la icona. Si existeix ../Untitled.icon, se sincronitza cap a
# les dues copies versionades (Tauri i assets del projecte).
ICON_SOURCE="../Untitled.icon"

# Carpeta on Icon Composer ha exportat les aparences (Default, Dark, Clear...).
# Es pot indicar amb ICON_EXPORTS o com a primer argument (directori o PNG).
EXPORTS_DIR="${ICON_EXPORTS:-}"
PNG_SRC=""
PNG_IS_EXPORT=0

if [ "$#" -gt 0 ]; then
    if [ -d "$1" ]; then
        EXPORTS_DIR="$1"
    elif [ -f "$1" ]; then
        PNG_SRC="$1"
    else
        printf '%s\n' "No existeix el fitxer o directori indicat: $1" >&2
        exit 1
    fi
fi

if [ -z "$EXPORTS_DIR" ]; then
    for candidate in "$DIR/../Untitled Exports" "$HOME/Downloads/Untitled Exports"; do
        if [ -d "$candidate" ]; then
            EXPORTS_DIR="$candidate"
            break
        fi
    done
fi

export_png() {
    # $1 = aparença d'Icon Composer (Default, Dark, ClearDark, ClearLight...)
    for candidate in \
        "$EXPORTS_DIR/Untitled-macOS-$1-1024@2x.png" \
        "$EXPORTS_DIR/Untitled-iOS-$1-1024@1x.png"
    do
        if [ -f "$candidate" ]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done
    return 1
}

if [ -z "$PNG_SRC" ]; then
    if [ -n "$EXPORTS_DIR" ] && [ -d "$EXPORTS_DIR" ]; then
        PNG_SRC="$(export_png Default || true)"
        if [ -n "$PNG_SRC" ]; then
            PNG_IS_EXPORT=1
        fi
    fi
    if [ -z "$PNG_SRC" ]; then
        printf '%s\n' "No s'ha trobat cap exportació de la icona per defecte." >&2
        printf '%s\n' "Exporta el logo des d'Icon Composer i indica la carpeta amb:" >&2
        printf '%s\n' "  ICON_EXPORTS=\"/ruta/a/Untitled Exports\" npm run icons:compile" >&2
        exit 1
    fi
fi

if [ -d "$ICON_SOURCE" ]; then
    printf '%s\n' "Sincronitzant Untitled.icon -> src-tauri/icons/AppIcon.icon i assets/icons/SherLock.icon..."
    rm -rf "src-tauri/icons/AppIcon.icon"
    cp -R "$ICON_SOURCE" "src-tauri/icons/AppIcon.icon"
    rm -rf "assets/icons/SherLock.icon"
    cp -R "$ICON_SOURCE" "assets/icons/SherLock.icon"
else
    printf '%s\n' "Avís: no s'ha trobat $ICON_SOURCE; es mantenen les fonts .icon actuals."
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sherlock-icons.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

CLEAN_ICONS=1
if ! python3 -c "import PIL" >/dev/null 2>&1; then
    CLEAN_ICONS=0
    printf '%s\n' "Avís: Pillow no disponible; no es netejaran les vores de les icones." >&2
fi

prepare_appearance() {
    # Neteja la vora de l'export i el deixa a 1024 px (o retorna l'original si
    # Pillow no hi és). El resultat es reutilitza durant tota l'execució.
    appearance="$1"
    src="$(export_png "$appearance" || true)"
    if [ -z "$src" ]; then
        return 1
    fi
    if [ "$CLEAN_ICONS" != 1 ]; then
        printf '%s\n' "$src"
        return 0
    fi
    dest="$TMP_DIR/clean-$appearance.png"
    if [ ! -f "$dest" ]; then
        python3 tools/clean_icon_edges.py "$src" "$dest" >/dev/null
    fi
    printf '%s\n' "$dest"
}

if [ "$PNG_IS_EXPORT" = 1 ]; then
    PNG_SRC="$(prepare_appearance Default)"
fi

# 1. Assets.car (aparences macOS 26: default, dark, clear, tinted)
if [ -x "/Applications/Xcode.app/Contents/Developer/usr/bin/actool" ]; then
    printf '%s\n' "Compilant Assets.car amb actool d'Xcode..."
    DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer" \
        xcrun actool src-tauri/icons/AppIcon.icon \
        --compile "$TMP_DIR" \
        --platform macosx \
        --minimum-deployment-target 11.0 \
        --output-format human-readable-text >/dev/null
    cp "$TMP_DIR/Assets.car" "src-tauri/icons/Assets.car"
else
    printf '%s\n' "Avís: actool no disponible; no s'ha actualitzat Assets.car." >&2
fi

# 2. Icones de l'aplicació Tauri (PNG, ICNS i ICO) a partir de l'export default
printf '%s\n' "Regenerant icones de l'aplicació (.icns, .ico, .png) des de: $PNG_SRC..."
npm run tauri -- icon "$PNG_SRC" -o "$TMP_DIR/tauri" >/dev/null 2>&1
for file in 32x32.png 64x64.png 128x128.png 128x128@2x.png icon.icns icon.ico icon.png; do
    cp "$TMP_DIR/tauri/$file" "src-tauri/icons/$file"
done

resize() {
    # $1 = origen, $2 = costat en píxels, $3 = destí
    sips -z "$2" "$2" "$1" --out "$3" >/dev/null 2>&1
}

copy_appearance() {
    # $1 = aparença, $2 = destí, $3 = costat en píxels (1024 per defecte)
    src="$(prepare_appearance "$1" || true)"
    if [ -z "$src" ]; then
        printf '%s\n' "Avís: no s'ha trobat l'aparença $1; es manté $2." >&2
        return 0
    fi
    resize "$src" "${3:-1024}" "$2"
}

# 3. Marques de la interfície (default, dark, clear i tinted)
mkdir -p assets/icons/appearances public/brand
copy_appearance Default "assets/icons/SherLock-brand.png"
copy_appearance Default "assets/icons/appearances/SherLock-brand.png"
copy_appearance Dark "assets/icons/appearances/SherLock-brand-dark.png"
copy_appearance ClearDark "assets/icons/appearances/SherLock-brand-clear-dark.png"
copy_appearance ClearLight "assets/icons/appearances/SherLock-brand-clear-light.png"
copy_appearance TintedDark "assets/icons/appearances/SherLock-brand-tinted-dark.png"
copy_appearance TintedLight "assets/icons/appearances/SherLock-brand-tinted-light.png"

copy_appearance Default "public/brand/SherLock-brand.png"
copy_appearance Dark "public/brand/SherLock-brand-dark.png"
copy_appearance ClearDark "public/brand/SherLock-brand-clear-dark.png"
copy_appearance ClearLight "public/brand/SherLock-brand-clear-light.png"

# 4. Icones de l'extensió del navegador (16, 48 i 128 px)
DEFAULT_SRC="$(prepare_appearance Default || true)"
if [ -n "$DEFAULT_SRC" ]; then
    resize "$DEFAULT_SRC" 16 "browser-extension/icons/icon16.png"
    resize "$DEFAULT_SRC" 48 "browser-extension/icons/icon48.png"
    resize "$DEFAULT_SRC" 128 "browser-extension/icons/icon128.png"
fi
copy_appearance Dark "browser-extension/icons/icon128-dark.png" 128
copy_appearance ClearDark "browser-extension/icons/icon128-clear-dark.png" 128
copy_appearance ClearLight "browser-extension/icons/icon128-clear-light.png" 128

# 5. Paquets de l'extensió (build/ i .zip), si el script existeix
if [ -x "browser-extension/build.sh" ]; then
    (cd browser-extension && ./build.sh >/dev/null 2>&1)
fi

# 6. Còpies locals de l'app macOS creades amb `npm run build:app`. Són
# artefactes ignorats per git; només se n'actualitzen els recursos de la icona.
for app in "SherLock.app" "src-tauri/target/release/bundle/macos/SherLock.app"; do
    if [ -d "$app/Contents/Resources" ]; then
        cp "src-tauri/icons/icon.icns" "$app/Contents/Resources/icon.icns"
        if [ -f "src-tauri/icons/Assets.car" ]; then
            cp "src-tauri/icons/Assets.car" "$app/Contents/Resources/Assets.car"
        fi
        printf '%s\n' "Actualitzada la icona de $app"
    fi
done

printf '\n%s\n' "✅ Totes les icones (Tauri, extensió, interfície i app local) s'han actualitzat correctament!"

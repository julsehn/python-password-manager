#!/bin/zsh

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR" || exit 1

cleanup_project_vite() {
    local vite_pid
    vite_pid="$(lsof -tiTCP:1420 -sTCP:LISTEN 2>/dev/null | head -n 1)"
    if [[ -n "$vite_pid" ]] && ps -p "$vite_pid" -o command= | grep -q "$PROJECT_DIR/node_modules"; then
        kill "$vite_pid" 2>/dev/null || true
    fi
}

cleanup_project_app() {
    local app_pids
    app_pids="$(pgrep -f "$PROJECT_DIR/src-tauri/target/debug/sherlock" 2>/dev/null || true)"
    if [[ -n "$app_pids" ]]; then
        kill $app_pids 2>/dev/null || true
    fi
}

VAULT_PATH="$HOME/.password_manager/vault.json"
if [[ -f "$VAULT_PATH" ]]; then
    echo ""
    echo "S'ha trobat una instància de SherLock local."
    local delete_vault="n"
    read -q -k 1 "delete_vault?Vols eliminar-la i començar de nou? [y/N] "
    echo ""
    if [[ "$delete_vault" == "y" || "$delete_vault" == "Y" ]]; then
        rm -f "$VAULT_PATH"
        echo "SherLock local eliminada."
    else
        echo "L'instància de SherLock local es conservarà."
    fi
fi

cleanup_project_vite
cleanup_project_app

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [[ -d "/Applications/Xcode.app/Contents/Developer" ]]; then
    export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
    export PATH="/Applications/Xcode.app/Contents/Developer/usr/bin:$PATH"
fi
[[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"
if [[ -d "$HOME/.rustup/toolchains" ]]; then
    CARGO_PATH="$(find "$HOME/.rustup/toolchains" -path '*/bin/cargo' -type f -perm -111 -print -quit 2>/dev/null)"
    RUST_BIN="${CARGO_PATH:h}"
    if [[ -n "$RUST_BIN" ]]; then
        export PATH="$RUST_BIN:$PATH"
        export CARGO="$CARGO_PATH"
    fi
fi

NPM="$(command -v npm)"
if [[ -z "$NPM" ]]; then
    echo "No s'ha trobat npm. Instal·la Node.js i torna-ho a provar."
    read -k 1 "?Prem qualsevol tecla per tancar..."
    exit 1
fi

if [[ ! -d "$PROJECT_DIR/node_modules" ]]; then
    echo "Preparant la interfície web..."
    "$NPM" install || {
        echo "No s'han pogut instal·lar les dependències."
        read -k 1 "?Prem qualsevol tecla per tancar..."
        exit 1
    }
fi

if [[ -x "$PROJECT_DIR/browser-extension/build.sh" ]]; then
    echo "Actualitzant l'extensio del navegador..."
    "$PROJECT_DIR/browser-extension/build.sh" || {
        echo "No s'ha pogut construir l'extensio del navegador."
        read -k 1 "?Prem qualsevol tecla per continuar..."
    }
fi

if [[ -x "$PROJECT_DIR/tools/install_native_host.sh" ]]; then
    echo "Instal·lant el Native Messaging Host fora de Documents..."
    "$PROJECT_DIR/tools/install_native_host.sh" || {
        echo "No s'ha pogut instal·lar el Native Messaging Host."
        read -k 1 "?Prem qualsevol tecla per continuar..."
    }
fi

echo "Extensió construïda a: $PROJECT_DIR/browser-extension/build/firefox"

# Firefox launches the native host itself with connected stdin/stdout.
# Starting the host here would detach it from the Native Messaging pipe.
FIREFOX_APP="/Applications/Firefox Developer Edition.app"
if [[ -d "$FIREFOX_APP" ]]; then
    echo "Iniciant Firefox Developer Edition..."
    open -a "$FIREFOX_APP"
else
    echo "No s'ha trobat Firefox Developer Edition a: $FIREFOX_APP"
fi

if [[ -n "$(command -v cargo)" || -n "$CARGO" ]]; then
    echo "Compilant SherLock amb Tauri (versió release)..."
    "$NPM" run tauri -- build --bundles app || {
        echo "No s'ha pogut compilar l'aplicació."
        read -k 1 "?Prem qualsevol tecla per tancar..."
        exit 1
    }

    APP_BUNDLE="$PROJECT_DIR/src-tauri/target/release/bundle/macos/SherLock.app"
    if [[ -d "$APP_BUNDLE" ]]; then
        echo "Deixant SherLock.app a l'arrel de python-password-manager..."
        rm -rf "$PROJECT_DIR/SherLock.app"
        cp -R "$APP_BUNDLE" "$PROJECT_DIR/SherLock.app"
        echo "✅ SherLock.app disponible a: $PROJECT_DIR/SherLock.app"

        echo "Generant instal·lador SherLock.pkg..."
        rm -f "$PROJECT_DIR/SherLock.pkg"
        pkgbuild --component "$PROJECT_DIR/SherLock.app" --install-location /Applications "$PROJECT_DIR/SherLock.pkg" >/dev/null 2>&1
        echo "✅ SherLock.pkg disponible a: $PROJECT_DIR/SherLock.pkg"

        echo "Iniciant SherLock..."
        open "$PROJECT_DIR/SherLock.app"
    else
        echo "Error: No s'ha trobat el fitxer compilat a: $APP_BUNDLE"
        read -k 1 "?Prem qualsevol tecla per tancar..."
        exit 1
    fi
else
    echo "Rust/Cargo encara no està disponible."
    echo "Obrint la interfície web al navegador com a alternativa..."
    "$NPM" run dev -- --open
fi

exit 0

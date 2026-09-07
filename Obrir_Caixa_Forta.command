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
    app_pids="$(pgrep -f "$PROJECT_DIR/src-tauri/target/debug/caixa-forta" 2>/dev/null || true)"
    if [[ -n "$app_pids" ]]; then
        kill $app_pids 2>/dev/null || true
    fi
}

cleanup_project_vite
cleanup_project_app
trap cleanup_project_vite EXIT

# Remove generated frontend state so the launcher always uses the current source.
rm -rf "$PROJECT_DIR/dist" "$PROJECT_DIR/node_modules/.vite"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
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

if [[ -n "$(command -v cargo)" ]]; then
    echo "Iniciant Caixa forta amb Tauri..."
    "$PROJECT_DIR/node_modules/.bin/tauri" dev
elif [[ -n "$CARGO" && -x "$CARGO" ]]; then
    echo "Iniciant Caixa forta amb Tauri..."
    "$PROJECT_DIR/node_modules/.bin/tauri" dev
else
    echo "Rust/Cargo encara no està disponible."
    echo "Obrint la interfície web al navegador com a alternativa..."
    "$NPM" run dev -- --open
fi

exit_code=$?

if [[ $exit_code -ne 0 ]]; then
    echo ""
    echo "La interfície no s'ha pogut iniciar. Revisa Node.js i Rust/Tauri."
    read -k 1 "?Prem qualsevol tecla per tancar..."
fi

exit $exit_code

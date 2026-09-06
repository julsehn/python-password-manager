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

cleanup_project_vite
trap cleanup_project_vite EXIT

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

if [[ -n "$(command -v cargo)" ]]; then
    echo "Iniciant Caixa forta amb Tauri..."
    "$NPM" run tauri dev
elif [[ -n "$CARGO" && -x "$CARGO" ]]; then
    echo "Iniciant Caixa forta amb Tauri..."
    "$NPM" run tauri dev
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

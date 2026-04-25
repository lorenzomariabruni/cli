#!/usr/bin/env bash
# =============================================================================
#  Agency CLI — Installer
#  Supporta: macOS, Linux, Windows (Git Bash / WSL)
#  - Installa automaticamente: @continuedev/cli, fswatch / inotify-tools
#  - Fallback locale se npm install -g fallisce per mancanza di permessi
# =============================================================================
set -euo pipefail

# ---- Colori ----------------------------------------------------------------
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
RED='\033[0;31m';   BOLD='\033[1m';      NC='\033[0m'
ok()   { echo -e "${GREEN}  [OK]${NC} $*"; }
info() { echo -e "${CYAN}  -->  ${NC}$*"; }
warn() { echo -e "${YELLOW}  [!!]${NC} $*"; }
err()  { echo -e "${RED}  [ERR]${NC} $*"; exit 1; }
hdr()  { echo -e "\n${CYAN}${BOLD}$*${NC}"; }

# ---- Percorsi --------------------------------------------------------------
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_MODS="$ROOT_DIR/.agency/node_modules"
LOCAL_CN="$LOCAL_MODS/.bin/cn"
CN_CONFIG_DIR="$HOME/.continue"
CN_CONFIG="$CN_CONFIG_DIR/config.yaml"

echo ""
echo -e "${CYAN}${BOLD}===============================================${NC}"
echo -e "${CYAN}${BOLD}  Agency Dev Assistant — Installer${NC}"
echo -e "${CYAN}${BOLD}===============================================${NC}"
echo ""

# ============================================================================
# 1. Rileva OS
# ============================================================================
detect_os() {
  case "$(uname -s)" in
    Darwin)  echo "macos" ;;
    Linux)   echo "linux" ;;
    MINGW*|CYGWIN*|MSYS*) echo "windows" ;;
    *)       echo "other" ;;
  esac
}
OS="$(detect_os)"
info "Sistema rilevato: $OS"

# ============================================================================
# 2. Controlla Node.js / npm
# ============================================================================
hdr "[1/4] Node.js"
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  warn "Node.js o npm non trovati. Tento installazione automatica..."
  if [ "$OS" = "macos" ] && command -v brew >/dev/null 2>&1; then
    brew install node
  elif [ "$OS" = "linux" ] && command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -qq && sudo apt-get install -y nodejs npm
  elif [ "$OS" = "linux" ] && command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y nodejs npm
  elif [ "$OS" = "linux" ] && command -v pacman >/dev/null 2>&1; then
    sudo pacman -Sy --noconfirm nodejs npm
  elif [ "$OS" = "windows" ]; then
    err "Su Windows installa Node.js manualmente da https://nodejs.org e rilancia questo script in Git Bash."
  else
    err "Impossibile installare Node.js automaticamente. Installa Node.js >= 20 da https://nodejs.org"
  fi
  command -v node >/dev/null 2>&1 || err "Node.js non disponibile dopo l'installazione."
fi
ok "Node.js $(node -v)  /  npm $(npm -v)"

# ============================================================================
# 3. Installa @continuedev/cli (cn)
# ============================================================================
hdr "[2/4] Continue CLI (cn)"

CN_BIN=""
if command -v cn >/dev/null 2>&1; then
  ok "cn gia\u2019 installato: $(cn --version 2>/dev/null || echo 'ok')"
  CN_BIN="$(command -v cn)"
else
  # --- Prova installazione globale ---
  info "Installo @continuedev/cli globalmente..."
  if npm install -g @continuedev/cli 2>/dev/null; then
    ok "Installato globalmente."
    CN_BIN="$(command -v cn)"
  else
    # --- Fallback: installazione locale nella cartella .agency/ ---
    warn "Installazione globale fallita (permessi insufficienti?)"
    warn "Fallback: installazione locale in .agency/node_modules/"

    mkdir -p "$ROOT_DIR/.agency"
    npm install --prefix "$ROOT_DIR/.agency" @continuedev/cli

    if [ ! -f "$LOCAL_CN" ]; then
      err "Installazione locale completata ma cn non trovato in $LOCAL_CN"
    fi

    CN_BIN="$LOCAL_CN"

    # Crea wrapper cn nella directory locale del progetto
    WRAPPER="$ROOT_DIR/.agency/bin/cn"
    mkdir -p "$(dirname "$WRAPPER")"
    cat > "$WRAPPER" <<WEOF
#!/usr/bin/env bash
exec "$LOCAL_CN" "\$@"
WEOF
    chmod +x "$WRAPPER"

    # Aggiorna PATH nella shell dell'utente
    SHELL_RC=""
    if [ -f "$HOME/.zshrc" ];  then SHELL_RC="$HOME/.zshrc"
    elif [ -f "$HOME/.bashrc" ]; then SHELL_RC="$HOME/.bashrc"
    fi
    if [ -n "$SHELL_RC" ]; then
      EXPORT_LINE="export PATH=\"\$PATH:$ROOT_DIR/.agency/bin\""
      if ! grep -Fq "$ROOT_DIR/.agency/bin" "$SHELL_RC" 2>/dev/null; then
        echo "" >> "$SHELL_RC"
        echo "# Agency CLI — fallback locale cn" >> "$SHELL_RC"
        echo "$EXPORT_LINE" >> "$SHELL_RC"
        ok "PATH aggiornato in $SHELL_RC — riapri il terminale o esegui: source $SHELL_RC"
      fi
    fi

    export PATH="$PATH:$ROOT_DIR/.agency/bin"
    ok "cn disponibile localmente: $WRAPPER"
  fi
fi

# ============================================================================
# 4. Installa fswatch / inotify-tools
# ============================================================================
hdr "[3/4] File watcher"

if command -v fswatch >/dev/null 2>&1; then
  ok "fswatch gia\u2019 installato."
elif command -v inotifywait >/dev/null 2>&1; then
  ok "inotifywait gia\u2019 installato."
else
  if [ "$OS" = "macos" ]; then
    if command -v brew >/dev/null 2>&1; then
      info "Installo fswatch con Homebrew..."
      brew install fswatch && ok "fswatch installato." || warn "fswatch non installato. Installa manualmente: brew install fswatch"
    else
      warn "Homebrew non trovato. Installa fswatch manualmente: brew install fswatch"
      warn "Installa Homebrew da https://brew.sh se necessario."
    fi
  elif [ "$OS" = "linux" ]; then
    if command -v apt-get >/dev/null 2>&1; then
      info "Installo inotify-tools..."
      sudo apt-get update -qq && sudo apt-get install -y inotify-tools && ok "inotify-tools installato."
    elif command -v dnf >/dev/null 2>&1; then
      sudo dnf install -y inotify-tools && ok "inotify-tools installato."
    elif command -v pacman >/dev/null 2>&1; then
      sudo pacman -Sy --noconfirm inotify-tools && ok "inotify-tools installato."
    else
      warn "Installa inotify-tools manualmente col tuo package manager."
    fi
  elif [ "$OS" = "windows" ]; then
    warn "Su Windows il file watcher non e\u2019 necessario (usa PowerShell Watch o l'IDE)."
  fi
fi

# ============================================================================
# 5. Crea ~/.continue/config.yaml se non esiste
# ============================================================================
hdr "[4/4] Configurazione Continue"
mkdir -p "$CN_CONFIG_DIR"
if [ ! -f "$CN_CONFIG" ]; then
  cat > "$CN_CONFIG" <<'YAML'
name: Agency Dev Assistant
version: "1"
models:
  - name: agency-model
    provider: openai
    apiBase: https://api.openai.com/v1
    apiKey: ""
    model: gpt-4o
tabAutocompleteModel:
  name: agency-autocomplete
  provider: openai
  apiBase: https://api.openai.com/v1
  apiKey: ""
  model: gpt-4o
YAML
  ok "Creato ~/.continue/config.yaml"
else
  ok "~/.continue/config.yaml gia\u2019 presente."
fi

# ============================================================================
# 6. Installa agency CLI (npm link o fallback locale)
# ============================================================================
cd "$ROOT_DIR"
info "Installo dipendenze npm del progetto..."
npm install --silent

if npm link 2>/dev/null; then
  ok "agency disponibile globalmente (npm link)"
else
  warn "npm link fallito (permessi). Creo wrapper locale agency..."

  AGENCY_WRAPPER="$ROOT_DIR/.agency/bin/agency"
  mkdir -p "$(dirname "$AGENCY_WRAPPER")"
  cat > "$AGENCY_WRAPPER" <<WEOF
#!/usr/bin/env bash
exec node "$ROOT_DIR/bin/agency" "\$@"
WEOF
  chmod +x "$AGENCY_WRAPPER"

  SHELL_RC=""
  if [ -f "$HOME/.zshrc" ];  then SHELL_RC="$HOME/.zshrc"
  elif [ -f "$HOME/.bashrc" ]; then SHELL_RC="$HOME/.bashrc"
  fi
  if [ -n "$SHELL_RC" ]; then
    EXPORT_LINE="export PATH=\"\$PATH:$ROOT_DIR/.agency/bin\""
    if ! grep -Fq "$ROOT_DIR/.agency/bin" "$SHELL_RC" 2>/dev/null; then
      echo "" >> "$SHELL_RC"
      echo "# Agency CLI" >> "$SHELL_RC"
      echo "$EXPORT_LINE" >> "$SHELL_RC"
      ok "PATH aggiornato in $SHELL_RC"
    fi
  fi
  export PATH="$PATH:$ROOT_DIR/.agency/bin"
  ok "agency disponibile come wrapper locale: $AGENCY_WRAPPER"
fi

# ============================================================================
# Fine
# ============================================================================
echo ""
echo -e "${GREEN}${BOLD}================================================${NC}"
echo -e "${GREEN}${BOLD}  Installazione completata!${NC}"
echo -e "${GREEN}${BOLD}================================================${NC}"
echo ""
echo -e "  Prossimi passi:\n"
echo -e "  ${CYAN}1.${NC} Configura il tuo provider AI:"
echo -e "     ${BOLD}agency models${NC}"
echo ""
echo -e "  ${CYAN}2.${NC} Inizializza un progetto:"
echo -e "     ${BOLD}cd mio-progetto && agency init${NC}"
echo ""
if echo "$PATH" | grep -q ".agency/bin"; then
  echo -e "  ${YELLOW}Nota:${NC} Se 'agency' non viene trovato, esegui:"
  echo -e "     ${BOLD}source ~/.zshrc${NC}  oppure  ${BOLD}source ~/.bashrc${NC}"
  echo ""
fi

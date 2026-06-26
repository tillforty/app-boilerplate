#!/usr/bin/env bash
#
# Tillforty App Boilerplate — interactive Ubuntu setup wizard.
#
# Walks through every configuration question, installs Docker if needed,
# writes .env, and starts the stack. Run this on a fresh Ubuntu server.
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/tillforty/app-boilerplate/main/setup.sh)
#
# Or if you've already cloned the repo:
#
#   ./setup.sh
#
set -euo pipefail

info()    { printf '\033[1;34m▶\033[0m %s\n' "$*"; }
ok()      { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
warn()    { printf '\033[1;33m!\033[0m %s\n' "$*"; }
die()     { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }
question(){ printf '\033[1;36m?\033[0m %s ' "$*"; }
header()  { printf '\n\033[1;37m══ %s ══\033[0m\n' "$*"; }

# ── Helpers ──────────────────────────────────────────────────────────────────

gen() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "${1:-32}";
  else head -c "${1:-32}" /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

ask() {
  # ask <var> <prompt> [default]
  local var="$1" prompt="$2" default="${3:-}"
  local display_default=""
  [ -n "$default" ] && display_default=" [${default}]"
  question "${prompt}${display_default}:"
  read -r input
  input="${input:-$default}"
  eval "${var}='${input}'"
}

ask_yn() {
  # ask_yn <var> <prompt> [y|n]
  local var="$1" prompt="$2" default="${3:-n}"
  local disp="y/N"; [ "$default" = "y" ] && disp="Y/n"
  question "${prompt} (${disp}):"
  read -r input
  input="${input:-$default}"
  case "$input" in
    [Yy]*) eval "${var}=true" ;;
    *)     eval "${var}=false" ;;
  esac
}

ask_secret() {
  # ask_secret <var> <prompt> [generated_default]
  local var="$1" prompt="$2" default="${3:-}"
  local generated=""
  [ -z "$default" ] && { generated="$(gen 32)"; default="$generated"; }
  question "${prompt} [leave blank to auto-generate]:"
  read -r -s input; echo
  input="${input:-$default}"
  eval "${var}='${input}'"
}

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

# ── Welcome ───────────────────────────────────────────────────────────────────

clear
cat <<'BANNER'

  ████████╗██╗██╗     ██╗     ███████╗ ██████╗ ██████╗ ████████╗██╗   ██╗
     ██╔══╝██║██║     ██║     ██╔════╝██╔═══██╗██╔══██╗╚══██╔══╝╚██╗ ██╔╝
     ██║   ██║██║     ██║     █████╗  ██║   ██║██████╔╝   ██║    ╚████╔╝
     ██║   ██║██║     ██║     ██╔══╝  ██║   ██║██╔══██╗   ██║     ╚██╔╝
     ██║   ██║███████╗███████╗██║     ╚██████╔╝██║  ██║   ██║      ██║
     ╚═╝   ╚═╝╚══════╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝  ╚═╝      ╚═╝

  App Boilerplate — Interactive Setup Wizard

BANNER

info "This wizard will configure your stack, install Docker (if needed),"
info "write .env, and start all services."
echo

# ── Check for existing .env ───────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

# If run via curl pipe, clone/pull the repo first.
if [ ! -f "$SCRIPT_DIR/docker-compose.yml" ]; then
  GIT_URL="${GIT_URL:-https://github.com/tillforty/app-boilerplate.git}"
  APP_DIR="${APP_DIR:-/opt/app-boilerplate}"
  info "Cloning repository to $APP_DIR…"
  $SUDO apt-get update -qq && $SUDO apt-get install -y -qq git curl
  if [ -d "$APP_DIR/.git" ]; then
    $SUDO git -C "$APP_DIR" pull --quiet
  else
    $SUDO git clone --quiet "$GIT_URL" "$APP_DIR"
  fi
  cd "$APP_DIR"
  SCRIPT_DIR="$APP_DIR"
else
  cd "$SCRIPT_DIR"
fi

if [ -f .env ]; then
  warn ".env already exists."
  ask_yn OVERWRITE "Overwrite it with fresh configuration?" "n"
  if [ "$OVERWRITE" = "false" ]; then
    info "Keeping existing .env — launching stack as-is."
    exec ./start.sh
  fi
fi

# ── Section 1: Deployment ─────────────────────────────────────────────────────

header "1 / 6  Deployment"

ask_yn USE_DOMAIN "Will this be a public server with a domain name?" "n"

DOMAIN=""
ACME_EMAIL=""
if [ "$USE_DOMAIN" = "true" ]; then
  ask DOMAIN "Domain name (e.g. app.example.com)" ""
  [ -z "$DOMAIN" ] && die "Domain name is required when deploying publicly."
  ask ACME_EMAIL "Email for Let's Encrypt notifications" ""
  ok "Public HTTPS will be enabled via Caddy (auto Let's Encrypt)."
else
  ok "Local-only mode — app will be available on http://localhost."
fi

ask WEB_PORT "Web UI port" "8080"
ask API_PORT "API port" "8000"

# ── Section 2: Database ───────────────────────────────────────────────────────

header "2 / 6  Database"

DB_USER="app"
DB_NAME="app"
DB_PASSWORD="$(gen 16)"
ask DB_PASSWORD "App Postgres password [leave blank to auto-generate]" ""
[ -z "$DB_PASSWORD" ] && DB_PASSWORD="$(gen 16)"
ok "App database: ${DB_USER}@postgres:5432/${DB_NAME}"

# ── Section 3: Admin account ──────────────────────────────────────────────────

header "3 / 6  Admin account"

ask ADMIN_EMAIL    "Admin email"    "admin@example.com"
ask ADMIN_NAME     "Admin first name" "Admin"
ask ADMIN_SURNAME  "Admin last name"  "User"
ADMIN_PASSWORD="$(gen 12)"
warn "Admin password will be auto-generated and shown at the end."

# ── Section 4: Security secrets ──────────────────────────────────────────────

header "4 / 6  Security secrets"
info "Secrets are auto-generated. You can customise them (advanced)."
ask_yn CUSTOM_SECRETS "Customise JWT / Vault secrets manually?" "n"

if [ "$CUSTOM_SECRETS" = "true" ]; then
  ask_secret JWT_SECRET  "JWT signing secret (32 hex chars)"
  ask_secret VAULT_KEY   "Vault encryption key (32 hex chars)"
else
  JWT_SECRET="$(gen 32)"
  VAULT_KEY="$(gen 32)"
  ok "Secrets auto-generated."
fi

# ── Section 5: n8n workflow automation ───────────────────────────────────────

header "5 / 6  n8n Workflow Automation (optional)"
info "n8n is an open-source workflow automation tool that connects to any API."
info "It gets its own dedicated Postgres database."

ask_yn N8N_ENABLED "Enable n8n?" "n"

N8N_POSTGRES_PASSWORD=""
N8N_ENCRYPTION_KEY=""
N8N_PORT="5678"
N8N_HOST="localhost"
N8N_PROTOCOL="http"
TIMEZONE="UTC"

if [ "$N8N_ENABLED" = "true" ]; then
  ask N8N_PORT "n8n port" "5678"
  ask TIMEZONE "Timezone for n8n schedules (e.g. Europe/Vilnius)" "UTC"
  if [ -n "$DOMAIN" ]; then
    N8N_HOST="$DOMAIN"
    N8N_PROTOCOL="https"
    ok "n8n webhook URL will be https://${DOMAIN}:${N8N_PORT}/"
  fi
  N8N_POSTGRES_PASSWORD="$(gen 16)"
  N8N_ENCRYPTION_KEY="$(gen 32)"
  ask_yn N8N_AUTH "Enable basic auth on the n8n UI?" "n"
  if [ "$N8N_AUTH" = "true" ]; then
    ask N8N_BASIC_AUTH_USER     "n8n UI username" "admin"
    ask_secret N8N_BASIC_AUTH_PASSWORD "n8n UI password"
    N8N_BASIC_AUTH_ACTIVE="true"
  else
    N8N_BASIC_AUTH_ACTIVE="false"
    N8N_BASIC_AUTH_USER=""
    N8N_BASIC_AUTH_PASSWORD=""
  fi
  ok "n8n will start at http://localhost:${N8N_PORT}"
else
  N8N_BASIC_AUTH_ACTIVE="false"
  N8N_BASIC_AUTH_USER=""
  N8N_BASIC_AUTH_PASSWORD=""
fi

# ── Section 6: Optional integrations ─────────────────────────────────────────

header "6 / 6  Optional integrations"

ask_yn CONFIGURE_SMTP "Configure SMTP (outbound email)?" "n"
SMTP_HOST="" SMTP_PORT="587" SMTP_USERNAME="" SMTP_PASSWORD=""
SMTP_FROM_EMAIL="" SMTP_FROM_NAME="Tillforty" SMTP_STARTTLS="true" SMTP_SSL="false"
if [ "$CONFIGURE_SMTP" = "true" ]; then
  ask SMTP_HOST     "SMTP host (e.g. smtp.gmail.com)" ""
  ask SMTP_PORT     "SMTP port (587=STARTTLS, 465=SSL)" "587"
  ask SMTP_USERNAME "SMTP username / email" ""
  ask_secret SMTP_PASSWORD "SMTP password / app password"
  ask SMTP_FROM_EMAIL "From address" "$SMTP_USERNAME"
  ask SMTP_FROM_NAME  "From display name" "Tillforty"
  [ "$SMTP_PORT" = "465" ] && { SMTP_STARTTLS="false"; SMTP_SSL="true"; }
  ok "SMTP configured."
fi

ask_yn CONFIGURE_LLM "Configure LLM / AI (OpenAI or compatible)?" "n"
OPERATING_AGENT_API_KEY="CHANGE_ME" OPERATING_AGENT_MODEL="gpt-4o" OPERATING_AGENT_BASE_URL=""
EMBEDDING_API_KEY="CHANGE_ME" EMBEDDING_MODEL="text-embedding-3-small" EMBEDDING_DIM="1536" EMBEDDING_BASE_URL=""
if [ "$CONFIGURE_LLM" = "true" ]; then
  ask OPERATING_AGENT_MODEL   "Operating agent model" "gpt-4o"
  ask_secret OPERATING_AGENT_API_KEY "Operating agent API key"
  ask OPERATING_AGENT_BASE_URL "Base URL override (blank = OpenAI default)" ""
  ask EMBEDDING_MODEL "Embedding model" "text-embedding-3-small"
  ask EMBEDDING_DIM   "Embedding dimension" "1536"
  ask_secret EMBEDDING_API_KEY "Embedding API key (blank = same as above)"
  [ -z "$EMBEDDING_API_KEY" ] && EMBEDDING_API_KEY="$OPERATING_AGENT_API_KEY"
  ok "LLM configured."
fi

# ── Write .env ────────────────────────────────────────────────────────────────

info "Writing .env…"
cp .env.example .env

set_env() {
  local key="$1" val="$2"
  KEY="$key" VAL="$val" awk '
    BEGIN { k=ENVIRON["KEY"]; v=ENVIRON["VAL"] }
    $0 ~ "^"k"=" { print k"="v; next }
    { print }
  ' .env > .env.tmp && mv .env.tmp .env
}

set_env DOMAIN                "$DOMAIN"
set_env ACME_EMAIL            "$ACME_EMAIL"
set_env WEB_PORT              "$WEB_PORT"
set_env API_PORT              "$API_PORT"
set_env POSTGRES_USER         "$DB_USER"
set_env POSTGRES_PASSWORD     "$DB_PASSWORD"
set_env POSTGRES_DB           "$DB_NAME"
set_env DATABASE_URL          "postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}"
set_env JWT_SECRET            "$JWT_SECRET"
set_env VAULT_KEY             "$VAULT_KEY"
set_env SEED_USER_EMAIL       "$ADMIN_EMAIL"
set_env SEED_USER_NAME        "$ADMIN_NAME"
set_env SEED_USER_SURNAME     "$ADMIN_SURNAME"
set_env SEED_USER_PASSWORD    "$ADMIN_PASSWORD"
set_env N8N_ENABLED           "$N8N_ENABLED"
set_env N8N_POSTGRES_PASSWORD "$N8N_POSTGRES_PASSWORD"
set_env N8N_ENCRYPTION_KEY    "$N8N_ENCRYPTION_KEY"
set_env N8N_HOST              "$N8N_HOST"
set_env N8N_PORT              "$N8N_PORT"
set_env N8N_PROTOCOL          "$N8N_PROTOCOL"
set_env N8N_BASIC_AUTH_ACTIVE "$N8N_BASIC_AUTH_ACTIVE"
set_env N8N_BASIC_AUTH_USER   "$N8N_BASIC_AUTH_USER"
set_env N8N_BASIC_AUTH_PASSWORD "$N8N_BASIC_AUTH_PASSWORD"
set_env TIMEZONE              "$TIMEZONE"
set_env SMTP_HOST             "$SMTP_HOST"
set_env SMTP_PORT             "$SMTP_PORT"
set_env SMTP_USERNAME         "$SMTP_USERNAME"
set_env SMTP_PASSWORD         "$SMTP_PASSWORD"
set_env SMTP_FROM_EMAIL       "$SMTP_FROM_EMAIL"
set_env SMTP_FROM_NAME        "$SMTP_FROM_NAME"
set_env SMTP_STARTTLS         "$SMTP_STARTTLS"
set_env SMTP_SSL              "$SMTP_SSL"
set_env OPERATING_AGENT_MODEL   "$OPERATING_AGENT_MODEL"
set_env OPERATING_AGENT_API_KEY "$OPERATING_AGENT_API_KEY"
set_env OPERATING_AGENT_BASE_URL "$OPERATING_AGENT_BASE_URL"
set_env EMBEDDING_MODEL       "$EMBEDDING_MODEL"
set_env EMBEDDING_DIM         "$EMBEDDING_DIM"
set_env EMBEDDING_API_KEY     "$EMBEDDING_API_KEY"
set_env EMBEDDING_BASE_URL    "$EMBEDDING_BASE_URL"

[ -n "$DOMAIN" ] && set_env OAUTH_REDIRECT_BASE_URL "https://${DOMAIN}"

ok ".env written."

# ── Install Docker if needed ──────────────────────────────────────────────────

if ! command -v docker >/dev/null 2>&1; then
  info "Docker not found — installing via get.docker.com…"
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq curl
  curl -fsSL https://get.docker.com | $SUDO sh
  $SUDO systemctl enable --now docker
  # Add current user to docker group so we don't need sudo for docker commands.
  if [ -n "${SUDO_USER:-}" ]; then
    $SUDO usermod -aG docker "$SUDO_USER"
    warn "Added $SUDO_USER to the docker group — log out and back in for group to take effect."
    warn "For this session, docker commands will be run with sudo."
  fi
  ok "Docker installed."
else
  ok "Docker already installed: $(docker --version)"
fi

$SUDO systemctl enable --now docker >/dev/null 2>&1 || true

# ── Summary ───────────────────────────────────────────────────────────────────

echo
cat <<EOF
$(printf '\033[1;37m')Configuration summary$(printf '\033[0m')
  Domain:       ${DOMAIN:-localhost (local-only)}
  Web port:     ${WEB_PORT}
  API port:     ${API_PORT}
  Admin email:  ${ADMIN_EMAIL}
  n8n:          ${N8N_ENABLED} $([ "$N8N_ENABLED" = "true" ] && echo "(port ${N8N_PORT})" || echo "")
  SMTP:         ${CONFIGURE_SMTP}
  LLM:          ${CONFIGURE_LLM}

EOF
warn "Admin password (save this — printed once): ${ADMIN_PASSWORD}"
echo

ask_yn START_NOW "Start the stack now?" "y"
if [ "$START_NOW" = "true" ]; then
  info "Handing off to start.sh…"
  exec ./start.sh
else
  ok "Setup complete. Run ./start.sh when ready."
fi

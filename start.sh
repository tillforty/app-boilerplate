#!/usr/bin/env bash
#
# Tillforty app boilerplate — one-command launcher.
#
#   ./start.sh            build + start everything (Postgres, migrations, API, web)
#   ./start.sh down       stop everything (keeps data)
#   ./start.sh destroy    stop everything AND delete the database/storage volumes
#   ./start.sh logs       follow logs
#
# On first run it creates .env from .env.example and auto-generates the DB and
# security secrets. The whole stack runs in Docker — nothing else is required on
# the host except Docker + the Compose plugin.
#
set -euo pipefail

cd "$(dirname "$0")"

# ── Pretty logging ───────────────────────────────────────────────────────────
info()  { printf '\033[1;34m▶\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m!\033[0m %s\n' "$*"; }
die()   { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# ── Preflight ────────────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || die "Docker is not installed. See https://docs.docker.com/engine/install/"
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  die "Docker Compose plugin not found. Install it: https://docs.docker.com/compose/install/"
fi
docker info >/dev/null 2>&1 || die "The Docker daemon isn't running or you lack permission (try: sudo systemctl start docker)."

# ── Secret generation helper ────────────────────────────────────────────────
gen() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "${1:-32}";
  else head -c "${1:-32}" /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

# Replace `KEY=...` with `KEY=<value>` in .env (value is taken literally).
set_env() {
  local key="$1" val="$2"
  # Use a temp file + awk to avoid sed delimiter/escaping pitfalls with secrets.
  KEY="$key" VAL="$val" awk '
    BEGIN { k=ENVIRON["KEY"]; v=ENVIRON["VAL"] }
    $0 ~ "^"k"=" { print k"="v; next }
    { print }
  ' .env > .env.tmp && mv .env.tmp .env
}

# ── First-run .env bootstrap ─────────────────────────────────────────────────
ADMIN_PASSWORD=""
if [ ! -f .env ]; then
  info "No .env found — creating one from .env.example and generating secrets."
  cp .env.example .env

  DB_PASSWORD="$(gen 16)"
  JWT_SECRET="$(gen 32)"
  VAULT_KEY="$(gen 32)"
  ADMIN_PASSWORD="$(gen 12)"

  set_env POSTGRES_PASSWORD "$DB_PASSWORD"
  set_env JWT_SECRET        "$JWT_SECRET"
  set_env VAULT_KEY         "$VAULT_KEY"
  set_env SEED_USER_PASSWORD "$ADMIN_PASSWORD"
  # Keep DATABASE_URL's password in sync with POSTGRES_PASSWORD.
  set_env DATABASE_URL "postgresql://app:${DB_PASSWORD}@postgres:5432/app"

  # Host port mappings (Compose has defaults, but expose them for easy editing).
  grep -q '^WEB_PORT=' .env || printf '\n# Host ports\nWEB_PORT=8080\nAPI_PORT=8000\n' >> .env

  # Deploy-time overrides from the environment (used by deploy.sh / unattended
  # installs). Applied only on first-run .env creation. Setting DOMAIN here makes
  # the public HTTPS proxy come up on this very run; OAuth's redirect base
  # defaults to https://DOMAIN unless explicitly provided.
  [ -n "${DOMAIN:-}" ]     && { set_env DOMAIN "$DOMAIN";         info "DOMAIN set from environment: $DOMAIN"; }
  [ -n "${ACME_EMAIL:-}" ] && set_env ACME_EMAIL "$ACME_EMAIL"
  [ -n "${CADDY_TLS:-}" ]  && { set_env CADDY_TLS "$CADDY_TLS";   info "CADDY_TLS set from environment: $CADDY_TLS"; }
  if [ -n "${OAUTH_REDIRECT_BASE_URL:-}" ]; then
    set_env OAUTH_REDIRECT_BASE_URL "$OAUTH_REDIRECT_BASE_URL"
  elif [ -n "${DOMAIN:-}" ]; then
    set_env OAUTH_REDIRECT_BASE_URL "https://${DOMAIN}"
  fi

  ok ".env created. DB/JWT/Vault secrets generated."
  warn "LLM keys (EMBEDDING_API_KEY / OPERATING_AGENT_API_KEY) are left as CHANGE_ME."
  warn "The app runs fine without them; fill them in .env to enable embeddings/LLM."
else
  info ".env already exists — leaving it untouched."
fi

# Source ports for the final summary (defaults match docker-compose.yml).
WEB_PORT="$(grep -E '^WEB_PORT=' .env | cut -d= -f2 || true)"; WEB_PORT="${WEB_PORT:-8080}"
API_PORT="$(grep -E '^API_PORT=' .env | cut -d= -f2 || true)"; API_PORT="${API_PORT:-8000}"

# When DOMAIN is set, run the optional Caddy reverse proxy (public HTTPS) by
# enabling the `public` compose profile. Exported so every $DC call below —
# up/down/destroy/logs — consistently includes the caddy service.
DOMAIN="$(grep -E '^DOMAIN=' .env | cut -d= -f2 || true)"
if [ -n "${DOMAIN:-}" ]; then
  export COMPOSE_PROFILES=public
  info "DOMAIN=${DOMAIN} — public HTTPS proxy (Caddy) enabled. Ensure ports 80/443 are free and DNS points here."
fi

# ── Subcommands ──────────────────────────────────────────────────────────────
case "${1:-up}" in
  down)    info "Stopping stack (data preserved)…"; $DC down; ok "Stopped."; exit 0 ;;
  destroy) warn "Stopping stack AND deleting volumes (all data lost)…"; $DC down -v; ok "Destroyed."; exit 0 ;;
  logs)    exec $DC logs -f ;;
  up|"")   ;; # fall through to launch
  *)       die "Unknown command: $1 (use: up | down | destroy | logs)" ;;
esac

# ── Launch ───────────────────────────────────────────────────────────────────
info "Building images and starting the stack (Postgres → migrations → API → web)…"
$DC up -d --build

# Wait for the API to report ready (it also runs schema self-seed on startup).
ready=0
if command -v curl >/dev/null 2>&1; then
  info "Waiting for the API to become ready…"
  for _ in $(seq 1 60); do
    if curl -fsS "http://localhost:${API_PORT}/ready" >/dev/null 2>&1; then ready=1; break; fi
    sleep 2
  done
else
  warn "curl not found — skipping the readiness wait. Check '$DC ps' / '$DC logs api'."
fi

echo
if [ "$ready" -eq 1 ]; then
  ok "Stack is up."
else
  warn "API didn't report ready within ~2 min. Check logs: $DC logs api"
fi

if [ -n "${DOMAIN:-}" ]; then
  cat <<EOF

  Public URL: https://${DOMAIN}        (Caddy is fetching a TLS cert — first
              request may take a few seconds; check '$DC logs caddy' if it stalls)
  API docs:   https://${DOMAIN}/api/docs
  Local:      http://localhost:${WEB_PORT}   (still published for direct access)

EOF
else
  cat <<EOF

  Web UI:     http://localhost:${WEB_PORT}
  API:        http://localhost:${API_PORT}
  API docs:   http://localhost:${WEB_PORT}/api/docs   (via the web proxy)

EOF
fi

if [ -n "$ADMIN_PASSWORD" ]; then
  ADMIN_EMAIL="$(grep -E '^SEED_USER_EMAIL=' .env | cut -d= -f2)"
  cat <<EOF
  First-run admin login (generated):
    email:    ${ADMIN_EMAIL}
    password: ${ADMIN_PASSWORD}

  Save these now — the password is only printed this once (it's stored hashed).
EOF
else
  info "Admin login uses SEED_USER_EMAIL / SEED_USER_PASSWORD from your existing .env."
fi

echo
info "Useful: '$DC logs -f' to follow logs, './start.sh down' to stop."

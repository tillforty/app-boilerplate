#!/usr/bin/env bash
#
# Tillforty app boilerplate — unattended one-shot deployer for a fresh server.
#
# Brings a brand-new Linux box from nothing to a live HTTPS app in one command:
# installs Docker (if missing), clones/updates the repo, writes the deploy config,
# and launches the stack with the Caddy HTTPS proxy. Idempotent — safe to re-run
# (re-runs become "git pull + rebuild", preserving the database and secrets).
#
# Fast path (run ON the target server, as root or with sudo):
#
#   curl -fsSL https://raw.githubusercontent.com/tillforty/app-boilerplate/main/deploy.sh \
#     | DOMAIN=app.tillforty.com ACME_EMAIL=ops@tillforty.com bash
#
# Or from your laptop, against a server you can SSH into:
#
#   ssh root@SERVER 'curl -fsSL https://raw.githubusercontent.com/tillforty/app-boilerplate/main/deploy.sh \
#     | DOMAIN=app.tillforty.com ACME_EMAIL=ops@tillforty.com bash'
#
# Prerequisites you must do yourself (DNS + firewall — see DEPLOY.md):
#   • An A record for $DOMAIN pointing at this server's public IP.
#   • Inbound TCP 80 and 443 open. (Cert issuance fails without both.)
#   • PRIVATE repo? This script clones as root (via sudo), which can't see a
#     per-user credential helper — so pass a token: GITHUB_TOKEN=<pat>. Public
#     repos need nothing. Note the `curl … | bash` one-liner itself fetches
#     deploy.sh from raw.githubusercontent.com, which also 404s for a private
#     repo — download the script with an auth header (or from a checkout) first.
#
# Tunables (all optional, via environment):
#   DOMAIN                  public hostname; omit for a local-only (no-TLS) run
#   ACME_EMAIL              Let's Encrypt contact email (recommended)
#   OAUTH_REDIRECT_BASE_URL defaults to https://$DOMAIN when DOMAIN is set
#   N8N_ENABLED             set to "true" to bring up n8n (on host port N8N_PORT)
#   N8N_PORT                n8n host port (default: 5678)
#   TIMEZONE                n8n schedule-trigger timezone (default: UTC)
#   GIT_URL                 repo to deploy (default: this repo on GitHub)
#   BRANCH                  branch to deploy (default: main)
#   APP_DIR                 checkout location (default: /opt/app-boilerplate)
#   GITHUB_TOKEN / GH_TOKEN token for cloning a PRIVATE repo (contents:read)
#
set -euo pipefail

GIT_URL="${GIT_URL:-https://github.com/tillforty/app-boilerplate.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/app-boilerplate}"

info()  { printf '\033[1;34m▶\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m!\033[0m %s\n' "$*"; }
die()   { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# Run a privileged command directly when root, else via sudo.
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || die "Not root and sudo not found. Re-run as root."
  SUDO="sudo"
fi

# ── Base tools (git + curl) ──────────────────────────────────────────────────
ensure_pkg() {
  command -v "$1" >/dev/null 2>&1 && return 0
  info "Installing $1…"
  if   command -v apt-get >/dev/null 2>&1; then $SUDO apt-get update -qq && $SUDO apt-get install -y -qq "$2"
  elif command -v dnf     >/dev/null 2>&1; then $SUDO dnf install -y -q "$2"
  elif command -v yum     >/dev/null 2>&1; then $SUDO yum install -y -q "$2"
  elif command -v apk     >/dev/null 2>&1; then $SUDO apk add --no-cache "$2"
  else die "No supported package manager found; install $1 manually and re-run."
  fi
}
ensure_pkg curl curl
ensure_pkg git  git

# ── Docker + Compose ─────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  info "Docker not found — installing via get.docker.com…"
  curl -fsSL https://get.docker.com | $SUDO sh
  ok "Docker installed."
fi
$SUDO systemctl enable --now docker >/dev/null 2>&1 || true
# Sanity: the Compose plugin must be present (get.docker.com ships it).
docker compose version >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1 \
  || die "Docker Compose plugin missing. See https://docs.docker.com/compose/install/"

# ── Clone or update the repo ─────────────────────────────────────────────────
# Private-repo auth: this script runs git as root (via sudo), which does NOT see
# a per-user credential helper (e.g. ~/.git-credentials belongs to your login
# user, not root). So for a PRIVATE repo, pass a token in the environment and we
# inject it into the HTTPS URL for the clone/fetch. Set GITHUB_TOKEN (or GH_TOKEN)
# to a PAT / fine-grained token with `contents:read` on the repo.
CLONE_URL="$GIT_URL"
GIT_TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
if [ -n "$GIT_TOKEN" ]; then
  case "$GIT_URL" in
    https://github.com/*)
      CLONE_URL="https://x-access-token:${GIT_TOKEN}@github.com/${GIT_URL#https://github.com/}"
      info "Using GITHUB_TOKEN for private-repo access." ;;
    *) warn "GITHUB_TOKEN set but GIT_URL isn't an https://github.com URL — ignoring." ;;
  esac
fi

if [ -d "$APP_DIR/.git" ]; then
  info "Updating existing checkout at $APP_DIR…"
  [ -n "$GIT_TOKEN" ] && $SUDO git -C "$APP_DIR" remote set-url origin "$CLONE_URL"
  $SUDO git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  $SUDO git -C "$APP_DIR" checkout --quiet "$BRANCH"
  $SUDO git -C "$APP_DIR" reset --hard --quiet "origin/$BRANCH"
  # Don't leave the token baked into the checkout's remote URL.
  [ -n "$GIT_TOKEN" ] && $SUDO git -C "$APP_DIR" remote set-url origin "$GIT_URL"
else
  info "Cloning $GIT_URL → $APP_DIR…"
  $SUDO mkdir -p "$(dirname "$APP_DIR")"
  $SUDO git clone --quiet --branch "$BRANCH" "$CLONE_URL" "$APP_DIR"
  # Reset the stored remote to the clean, token-free URL.
  [ -n "$GIT_TOKEN" ] && $SUDO git -C "$APP_DIR" remote set-url origin "$GIT_URL"
fi

# ── Launch ───────────────────────────────────────────────────────────────────
# start.sh creates .env + secrets on first run and, when DOMAIN is exported,
# bakes it in and brings up the Caddy HTTPS proxy. On later runs .env is left
# untouched and this is just a rebuild. Export the deploy vars for it.
export DOMAIN="${DOMAIN:-}"
export ACME_EMAIL="${ACME_EMAIL:-}"
export OAUTH_REDIRECT_BASE_URL="${OAUTH_REDIRECT_BASE_URL:-}"
export CADDY_TLS="${CADDY_TLS:-}"
export N8N_ENABLED="${N8N_ENABLED:-}"
export N8N_PORT="${N8N_PORT:-}"
export TIMEZONE="${TIMEZONE:-}"

[ -n "$DOMAIN" ] || warn "DOMAIN not set — deploying local-only (HTTP on :8080, no TLS)."

info "Handing off to start.sh…"
cd "$APP_DIR"
if [ -n "$SUDO" ]; then
  # Run the stack as root (Docker), forwarding the deploy vars through sudo.
  exec sudo --preserve-env=DOMAIN,ACME_EMAIL,OAUTH_REDIRECT_BASE_URL,CADDY_TLS,N8N_ENABLED,N8N_PORT,TIMEZONE ./start.sh
else
  exec ./start.sh
fi

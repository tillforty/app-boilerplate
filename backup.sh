#!/usr/bin/env bash
#
# Tillforty App Boilerplate — backup script.
#
# Creates a timestamped dump of the app database (and optionally n8n database),
# compresses it, and optionally uploads to S3-compatible storage.
#
#   ./backup.sh              — backup app DB to ./backups/
#   ./backup.sh --n8n        — also backup n8n DB
#   ./backup.sh --upload     — upload to S3 after backup
#   ./backup.sh --restore <file>   — restore app DB from a .sql.gz file
#
# Schedule with cron (daily at 3am):
#   0 3 * * * /opt/app-boilerplate/backup.sh --n8n --upload >> /var/log/app-backup.log 2>&1
#
set -euo pipefail

cd "$(dirname "$0")"

info()  { printf '\033[1;34m▶\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m!\033[0m %s\n' "$*"; }
die()   { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# ── Parse args ───────────────────────────────────────────────────────────────

BACKUP_N8N=false
UPLOAD=false
RESTORE_FILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --n8n)         BACKUP_N8N=true ;;
    --upload)      UPLOAD=true ;;
    --restore)     RESTORE_FILE="${2:-}"; shift ;;
    -h|--help)
      sed -n '2,20p' "$0" | grep '^#' | sed 's/^# \?//'
      exit 0 ;;
    *) die "Unknown argument: $1" ;;
  esac
  shift
done

# ── Load config from .env ────────────────────────────────────────────────────

[ -f .env ] || die ".env not found. Run ./start.sh first."

_env() { grep -E "^${1}=" .env | cut -d= -f2- || true; }

DATABASE_URL="$(_env DATABASE_URL)"
N8N_POSTGRES_USER="$(_env N8N_POSTGRES_USER)"; N8N_POSTGRES_USER="${N8N_POSTGRES_USER:-n8n}"
N8N_POSTGRES_PASSWORD="$(_env N8N_POSTGRES_PASSWORD)"
N8N_POSTGRES_DB="$(_env N8N_POSTGRES_DB)"; N8N_POSTGRES_DB="${N8N_POSTGRES_DB:-n8n}"

# S3 settings (for --upload). Set in .env or export before running.
S3_BUCKET="${S3_BUCKET:-$(_env S3_BUCKET)}"
S3_PREFIX="${S3_PREFIX:-$(_env S3_PREFIX)}"
S3_PREFIX="${S3_PREFIX:-backups}"
AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-$(_env AWS_ACCESS_KEY_ID)}"
AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-$(_env AWS_SECRET_ACCESS_KEY)}"
AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-$(_env AWS_DEFAULT_REGION)}"
AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
# For non-AWS S3 (Cloudflare R2, MinIO, etc.):
AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-$(_env AWS_ENDPOINT_URL)}"

BACKUP_DIR="./backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

# ── Docker Compose helper ────────────────────────────────────────────────────

if docker compose version >/dev/null 2>&1; then DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then DC="docker-compose"
else die "Docker Compose not found."
fi

# ── Restore mode ─────────────────────────────────────────────────────────────

if [ -n "$RESTORE_FILE" ]; then
  [ -f "$RESTORE_FILE" ] || die "Restore file not found: $RESTORE_FILE"
  warn "This will OVERWRITE the current app database. Are you sure? (yes/N)"
  read -r confirm
  [ "$confirm" = "yes" ] || die "Restore cancelled."
  info "Restoring from $RESTORE_FILE…"
  gunzip -c "$RESTORE_FILE" | $DC exec -T postgres psql "$DATABASE_URL"
  ok "Restore complete."
  exit 0
fi

# ── Backup app DB ─────────────────────────────────────────────────────────────

APP_DUMP="${BACKUP_DIR}/app_${TIMESTAMP}.sql.gz"
info "Dumping app database → ${APP_DUMP}…"
$DC exec -T postgres pg_dump "$DATABASE_URL" | gzip > "$APP_DUMP"
ok "App DB backup: ${APP_DUMP} ($(du -sh "$APP_DUMP" | cut -f1))"

# ── Backup n8n DB ────────────────────────────────────────────────────────────

if [ "$BACKUP_N8N" = "true" ]; then
  N8N_DSN="postgresql://${N8N_POSTGRES_USER}:${N8N_POSTGRES_PASSWORD}@localhost:5432/${N8N_POSTGRES_DB}"
  N8N_DUMP="${BACKUP_DIR}/n8n_${TIMESTAMP}.sql.gz"
  info "Dumping n8n database → ${N8N_DUMP}…"
  $DC exec -T n8n_postgres pg_dump "$N8N_DSN" | gzip > "$N8N_DUMP"
  ok "n8n DB backup: ${N8N_DUMP} ($(du -sh "$N8N_DUMP" | cut -f1))"
fi

# ── Rotate local backups (keep last 14 days) ──────────────────────────────────

find "$BACKUP_DIR" -name "*.sql.gz" -mtime +14 -delete 2>/dev/null || true
info "Local backups older than 14 days removed."

# ── Upload to S3 ─────────────────────────────────────────────────────────────

if [ "$UPLOAD" = "true" ]; then
  [ -n "$S3_BUCKET" ] || die "S3_BUCKET not set. Add it to .env or export it."
  command -v aws >/dev/null 2>&1 || die "AWS CLI not installed. Install it: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html"

  S3_ENDPOINT_FLAG=""
  [ -n "$AWS_ENDPOINT_URL" ] && S3_ENDPOINT_FLAG="--endpoint-url $AWS_ENDPOINT_URL"

  upload_file() {
    local file="$1"
    local dest="s3://${S3_BUCKET}/${S3_PREFIX}/$(basename "$file")"
    info "Uploading $file → $dest"
    # shellcheck disable=SC2086
    aws s3 cp "$file" "$dest" $S3_ENDPOINT_FLAG --quiet
    ok "Uploaded: $dest"
  }

  export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION
  upload_file "$APP_DUMP"
  [ "$BACKUP_N8N" = "true" ] && upload_file "$N8N_DUMP"
fi

echo
ok "Backup complete. Files in ${BACKUP_DIR}/"
ls -lh "$BACKUP_DIR"/*.sql.gz 2>/dev/null | tail -10 || true

#!/bin/sh
# Entrypoint for the `migrate` service: baseline if needed, then apply.
#
# Migrations are versioned by dbmate, which records every applied file in a
# `schema_migrations` table. That ledger is the whole point: before it, every
# .sql file re-ran on every single boot, so each one had to be hand-written
# idempotent forever and data backfills re-executed against live rows.
#
# Three paths, decided below:
#   fresh     no `users` table          → dbmate applies everything from 0001.
#   baseline  pre-dbmate install, current → record the 17 cutover migrations as
#             already applied WITHOUT running them (the schema is already there).
#   replay    pre-dbmate install, behind  → apply everything; safe because every
#             cutover-era migration is idempotent by construction.
set -eu

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/db/migrations}"

log() { echo "[migrate] $*"; }
die() { echo "[migrate] ERROR: $*" >&2; exit 1; }

[ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL is not set"

# ── 1. Normalise the URL for dbmate ─────────────────────────────────────────
# dbmate hands the DSN to lib/pq, which defaults to sslmode=require and would
# refuse the plaintext link to the postgres container. The app's own asyncpg
# DSN has no sslmode, so add one here rather than making everyone edit .env.
case "$DATABASE_URL" in
  *sslmode=*) ;;
  *\?*)       DATABASE_URL="${DATABASE_URL}&sslmode=${PGSSLMODE:-disable}" ;;
  *)          DATABASE_URL="${DATABASE_URL}?sslmode=${PGSSLMODE:-disable}" ;;
esac
export DATABASE_URL

# ── 2. Refuse a forked version sequence ─────────────────────────────────────
# Two branches adding a migration on the same number is the classic fork hazard:
# dbmate would record one version and silently skip the other file forever.
dupes="$(basename -a "$MIGRATIONS_DIR"/*.sql | cut -d_ -f1 | sort | uniq -d)"
[ -z "$dupes" ] || die "duplicate migration version(s) — rename one side: $dupes"

# ── 3. Wait for Postgres ────────────────────────────────────────────────────
log "waiting for the database…"
dbmate --wait --wait-timeout 60s --no-dump-schema wait

# ── 4. Decide: fresh / baseline / replay ────────────────────────────────────
# Versions that existed at the dbmate cutover. HARDCODED on purpose: deriving it
# from the directory would mark any migration added later as applied without
# ever running it, on the first old install that upgrades.
BASELINE_VERSIONS="0001 0002 0003 0004 0005 0006 0007 0008 0009 0010 0011 0012 0013 0014 0015 0016 202608122115"

q() { psql "$DATABASE_URL" -tAX -c "$1"; }

has_ledger="$(q "SELECT to_regclass('public.schema_migrations') IS NOT NULL")"
has_users="$(q "SELECT to_regclass('public.users') IS NOT NULL")"
# Artefact of the newest cutover migration (202608122115). Its presence means the
# legacy every-boot runner had applied the full set before this upgrade.
is_current="$(q "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                                WHERE table_schema='public' AND table_name='dev_jobs'
                                  AND column_name='cache_read_tokens')")"

if [ "$has_ledger" = "t" ]; then
  log "ledger present — incremental run"
elif [ "$has_users" != "t" ]; then
  log "fresh database — applying every migration from the start"
elif [ "$is_current" = "t" ]; then
  log "pre-dbmate install detected and fully migrated — baselining as applied"
  values=""
  for v in $BASELINE_VERSIONS; do values="${values}('${v}'),"; done
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q <<SQL
CREATE TABLE IF NOT EXISTS schema_migrations (version varchar(255) PRIMARY KEY);
INSERT INTO schema_migrations (version) VALUES ${values%,}
ON CONFLICT (version) DO NOTHING;
SQL
  log "baselined $(echo "$BASELINE_VERSIONS" | wc -w) migration(s)"
else
  # Has users but is missing the newest cutover column: an install that stopped
  # short. Don't baseline — that would mark unapplied work as done. Replaying is
  # safe here precisely because the legacy files are all idempotent.
  log "WARNING: pre-dbmate install is behind the cutover set — replaying all"
  log "WARNING: cutover-era migrations are idempotent, so this is safe, but"
  log "WARNING: check the result before trusting it."
fi

# ── 5. Apply ────────────────────────────────────────────────────────────────
# dbmate wraps each migration in its own transaction: a failure rolls that file
# back whole instead of leaving the half-applied state the old psql loop left.
log "applying pending migrations…"
dbmate --no-dump-schema up
log "done."
dbmate --no-dump-schema status

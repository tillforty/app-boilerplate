# Prompt: migrate a Tillforty install to dbmate-versioned migrations

Copy everything below the line into a coding agent running **on the target
server**, in the checkout root (usually `/opt/app-boilerplate`).

If that server tracks this same repo and has no local divergence, you do not
need this — `git pull && ./start.sh` is enough, and `scripts/db_migrate.sh` will
baseline the existing database on the first boot. Use this prompt when the
server runs a **forked or diverged** copy that has to have the change applied to
it directly.

---

You are working on a Tillforty app-boilerplate install: FastAPI + raw `asyncpg`
(no ORM) + Postgres, orchestrated by `docker-compose.yml`. Your task is to
replace the SQL migration runner with **dbmate**, so migrations have a ledger,
transactions, and rollbacks.

**This is a live server. Do not restart the running stack until the end, and
take a database backup before you do.**

## Step 0 — establish what you are working with

Confirm before changing anything, and report what you find:

- Does `docker-compose.yml` have a `migrate` service that loops over
  `migrations/*.sql` with `psql`? If it already uses `ghcr.io/amacneil/dbmate`,
  the cutover is done — stop and say so.
- Does the database have a `schema_migrations` table? (If yes, likewise stop.)
- List `migrations/*.sql`. Record the exact set of version prefixes (the digits
  before the first `_`). **You will need this exact list in Step 3.**
- Grep the backend for DDL in Python:
  `grep -rn "CREATE TABLE\|ADD COLUMN IF NOT EXISTS\|CREATE EXTENSION" --include=*.py backend/`
  These are the mirrors you will retire in Step 5.

## Step 1 — convert every migration to dbmate format

Each file needs an explicit up block and, wherever possible, a down block:

```sql
-- (keep the existing header comments — they are documentation)

-- migrate:up
<the file's existing SQL, unchanged>

-- migrate:down
<statements that reverse it, in reverse dependency order>
```

Rules for the down blocks:

- Reverse order within the file: drop what the up block created last, first.
- Where a down cannot be clean, make it fail loudly rather than silently lie.
  Example: a migration that made a `NOT NULL` column nullable cannot restore the
  constraint if rows now hold NULLs — `RAISE EXCEPTION` with the row count and
  the fix, instead of leaving the column nullable.
- Where a down narrows an enum/CHECK vocabulary, first `UPDATE` rows that use a
  now-invalid value to the closest valid one, and comment why that mapping.
- Do **not** rewrite the up blocks. They are history, and on existing databases
  they will never run again.

## Step 2 — write `scripts/db_migrate.sh`

The entrypoint for the migrate container. It must:

1. Fail if `DATABASE_URL` is unset.
2. Append `sslmode=disable` to `DATABASE_URL` if it has no `sslmode` — dbmate
   uses lib/pq, which defaults to `sslmode=require` and will refuse the
   plaintext link to the postgres container.
3. Abort if two migration files share a version prefix (a fork hazard: dbmate
   records one version and skips the other file forever).
4. `dbmate --wait --wait-timeout 60s --no-dump-schema wait`.
5. Run the Step 3 baseline decision.
6. `dbmate --no-dump-schema up`, then print `dbmate --no-dump-schema status`.

Use `--no-dump-schema` throughout: the migrations directory is mounted
read-only, and a schema dump there would fail.

## Step 3 — the baseline decision (the part that must be right)

An existing install already has the full schema but no ledger. Applying the
migrations to it would re-run data backfills against live rows. Detect it and
record the versions as applied *without running them*:

- `schema_migrations` exists → nothing to do, incremental run.
- No `users` table → fresh database, let dbmate apply everything.
- `users` exists **and** the artefact of the newest pre-cutover migration is
  present (pick a column that migration added and check
  `information_schema.columns`) → create `schema_migrations
  (version varchar(255) PRIMARY KEY)` and `INSERT` every pre-cutover version
  with `ON CONFLICT DO NOTHING`.
- `users` exists but that artefact is missing → the install is behind. Do **not**
  baseline; log a warning and let dbmate apply everything. This is safe only
  because the pre-cutover files were written idempotently — verify that before
  relying on it.

**Hardcode the baseline version list** from Step 0. Do not derive it from the
directory at runtime: a migration added after the cutover would then be marked
applied without ever having run, the first time an old install upgrades.

## Step 4 — swap the compose service

```yaml
  migrate:
    image: ghcr.io/amacneil/dbmate:2
    restart: "no"
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DBMATE_MIGRATIONS_DIR: /db/migrations
      MIGRATIONS_DIR: /db/migrations
      PGSSLMODE: ${PGSSLMODE:-disable}
    volumes:
      - ./migrations:/db/migrations:ro
      - ./scripts/db_migrate.sh:/db/db_migrate.sh:ro
    entrypoint: ["sh", "/db/db_migrate.sh"]
```

Keep every `depends_on: migrate: condition: service_completed_successfully` on
the other services — that gate is what stops application code from starting
against a schema it does not match.

`PGSSLMODE` is set here as well as in the script so that overriding the
entrypoint (`docker compose run --rm --entrypoint dbmate migrate ... down`)
still connects.

## Step 5 — retire the Python DDL mirrors

The `ensure_schema*()` functions re-declare the schema so a code deploy could
run ahead of its migration. With the migrate gate that is redundant, and two
sources of truth drift. Remove the DDL — but **read each one first**, because
some are not pure mirrors:

- Keep all **seeding**: the SEED_USER_* admin, system roles, singleton rows.
- Keep non-DB side effects, e.g. creating `STORAGE_DIR`.
- Watch for a mirror that is *parameterised* where the SQL is hardcoded (in this
  codebase, the customers embedding column is built from `EMBEDDING_DIM` while
  the migration pins 1536). Do not silently drop that difference — replace it
  with a check that warns, and report it.
- Watch for a mirror whose seed data is **ahead** of the migration. Report the
  divergence; do not "fix" permissions or roles on your own initiative.

Then remove the corresponding calls from the startup lifespan in
`backend/app/main.py`, and drop any import that becomes unused.

## Step 6 — verify before you deploy

Do all of this against a **throwaway** Postgres container, never the live one:

1. Fresh database → all migrations apply.
2. Run again → zero pending, nothing re-applied.
3. Roll every migration back one at a time → all downs succeed, and the only
   table left is `schema_migrations`.
4. Apply again → clean.
5. Simulate a legacy install: apply everything, `DROP TABLE schema_migrations`,
   insert a user row, run the script → it must report baselining, apply 0
   migrations, and leave that row untouched.
6. Simulate a behind install: also drop a column the newest migration added →
   it must report replaying and restore the column.
7. Duplicate-version guard: copy a migration to a second file with the same
   prefix → the script must abort.
8. Build the backend image and boot it against the migrations-only database.
   It must reach `/health` 200, and the seeded admin must be able to log in.

## Step 7 — deploy

```bash
./backup.sh
docker compose config --quiet
./start.sh
docker compose logs migrate     # confirm which path it took
```

## Report back

State which of fresh/baseline/replay the server took, the migrate service logs,
any mirror whose behaviour you could not preserve exactly, and any place you
found the Python seeds and the SQL disagreeing.

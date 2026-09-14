# CLAUDE.md — app-boilerplate

Instructions for agents working in this repo. The README is the human-facing
tour; this file is the set of rules you must not break.

## Stack in one line

FastAPI (Python, raw `asyncpg` — **no ORM**) + React/Vite + Postgres
(pgcrypto, pgvector), orchestrated by `docker-compose.yml`, fronted by Caddy.

---

## Database migration policy

Migrations are versioned with **dbmate**. `migrations/` is the single source of
truth for the schema. Every applied file is recorded in a `schema_migrations`
ledger, so each one runs **exactly once**, **inside its own transaction**.

### Rules

1. **All DDL lives in `migrations/`. Never in Python.**
   The backend used to mirror every `CREATE TABLE` in an `ensure_schema()`
   function so a code deploy could run ahead of its migration. That is gone —
   the `migrate` service is a hard gate (`depends_on: service_completed_successfully`),
   so the schema is always in place before `api` starts. Adding DDL back to
   application code re-creates two sources of truth that silently drift.

   What legitimately remains in `ensure_schema*()`: **seeding and runtime
   bootstrap only** — the SEED_USER_* admin, system roles, the `app_settings`
   singleton, `STORAGE_DIR` creation, the embedding-width check.

2. **Never edit a migration that has shipped.** The ledger records it as
   applied, so your edit runs nowhere and environments diverge with no error.
   Fix forward with a new migration.

3. **Name new files `YYYYMMDDHHMM_name.sql`.** The `0001`–`0016` files are
   historical. Timestamps sort after them and two forks can never collide.
   `scripts/db_migrate.sh` aborts on a duplicate version rather than recording
   one file and skipping the other forever.

4. **Write both directions.** dbmate requires `-- migrate:up`; write
   `-- migrate:down` too. If a down is genuinely impossible (a destructive
   backfill), say so in a comment and `RAISE EXCEPTION` with the reason — a down
   block that silently does nothing makes the ledger lie about the schema.

5. **Idempotency is no longer required** for new files. `IF NOT EXISTS` on the
   old files is a leftover from when the whole directory replayed every boot.
   New migrations may contain backfills, `UPDATE`s, and destructive DDL.

6. **Respect the dependency order.** `0001` enables pgcrypto (the vault in
   `0004` needs it); `0005` enables pgvector (the `customers.embedding` column
   in `0007` needs it); `0002` creates `users`, referenced by most later tables.

7. **`EMBEDDING_DIM` is pinned to 1536 in `0007_customers.sql`.** Overriding the
   env var alone does not widen the column — `customers.ensure_schema()` only
   logs a warning. Changing it needs a real `ALTER TABLE` migration.

### Adding a migration

```bash
# 1. create it (timestamp prefix, both directions)
cat > migrations/202609141200_add_invoices.sql <<'SQL'
-- migrate:up
CREATE TABLE invoices (...);

-- migrate:down
DROP TABLE invoices;
SQL

# 2. apply + verify the round trip on a throwaway database BEFORE shipping
docker compose run --rm migrate               # up
docker compose run --rm --entrypoint dbmate migrate --no-dump-schema down   # verify down
docker compose run --rm migrate               # up again
```

A migration whose `down` has never been executed is untested. Run the round
trip; it is the only thing that proves the ledger and the schema agree.

---

## CI/CD

`.github/workflows/tests.yml` runs on every pull request and every push to
`main`: `pytest` for the backend, `tsc -b` + `vitest` for the web app.

**CI never touches a database.** `backend/tests/conftest.py` monkeypatches
`db.get_pool` with a `FakePool` returning canned results, so no Postgres is
started and **migrations are not exercised by CI at all**. A green build tells
you nothing about whether your migration applies, or whether its `down` works.
Run the up/down round trip yourself against a throwaway Postgres — see "Adding a
migration" above. Do not treat a passing pipeline as migration coverage.

**CI does not deploy.** Deployment is a command on the server. Do not add a
remote/CI deploy path without being asked — see `DEPLOY.md`.

### How migrations reach production

`./start.sh` runs `docker compose up -d --build`, and compose enforces the
ordering:

```
postgres (healthcheck)
   └─> migrate   ← one-shot: baseline if needed, apply pending, exit
         └─> api, agent_runner   (depends_on: service_completed_successfully)
```

If `migrate` exits non-zero, `api` and `agent_runner` **never start**. That is
deliberate: a failed migration must stop the deploy, not leave application code
running against a schema it does not match.

### Upgrading a database that predates dbmate

`scripts/db_migrate.sh` decides between three paths and logs which one it took:

| Path | Condition | Behaviour |
| --- | --- | --- |
| fresh | no `users` table | apply every migration from `0001` |
| baseline | pre-dbmate, fully migrated | record the 17 cutover versions as applied **without running them** |
| replay | pre-dbmate, behind the cutover | apply everything (safe — cutover-era files are idempotent) |

The baseline version list is **hardcoded**. Do not change it to read the
directory: that would mark any post-cutover migration as applied without ever
running it, on the first old install that upgrades.

### Rolling back

```bash
docker compose run --rm --entrypoint dbmate migrate --no-dump-schema down
```

Rolls back one migration. Application code is *not* rolled back — redeploy the
matching commit as well, or the API will query columns that no longer exist.

### Before deploying

```bash
./backup.sh                                   # snapshot the database first
docker compose config --quiet                 # compose file parses
docker compose run --rm --entrypoint dbmate migrate --no-dump-schema status
```

---

## Things that bite

- **`deploy` from the Development page fails on this server** — repo ownership
  and GitHub auth. Ship with `./start.sh` on the box instead.
- **The active nav layout is `Header`**; `Sidebar.tsx` was deleted. Nav and
  settings-menu changes go in the Header.
- **n8n webhooks**: the backend and the browser need *different* base URLs.
  n8n sits behind Caddy on `:5678`.
- **i18n parity is build-enforced** — a missing key fails the web build.

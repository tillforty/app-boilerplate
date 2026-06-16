# Tillforty App Boilerplate

A full-stack starter shared across Tillforty apps:

- **Frontend** — a [shadcn](https://ui.shadcn.com) **registry** of the Tillforty UI kit (theme, app shell, auth scaffold, API client). Consuming apps pull components in *as editable source* with the shadcn CLI and pull updates later as reviewable diffs.
- **Backend** — a FastAPI template with **users + JWT auth**, an **encrypted secret vault** (pgcrypto), and **file storage** (binaries on disk, metadata in Postgres).
- **Database** — the SQL migrations every app needs to provision the above.

```
app-boilerplate/
├─ registry/            # frontend source, distributed via the shadcn registry
│  ├─ theme/tokens.css      → src/index.css
│  ├─ lib/{utils,api,auth}.ts
│  ├─ config/app-config.tsx # << the one file each app edits (brand + nav)
│  └─ blocks/{auth,app-shell}/
├─ registry.json        # registry manifest (`shadcn build` → /r/*.json)
├─ tailwind-preset.js   # shared Tailwind theme preset
├─ components.json.example
├─ backend/             # FastAPI app: auth + vault + files
│  ├─ app/{db,security,auth,vault,files,main}.py
│  ├─ requirements.txt
│  └─ .env.example
└─ migrations/          # SQL — run in order
   ├─ 0001_extensions.sql
   ├─ 0002_users.sql
   ├─ 0003_files.sql
   └─ 0004_vault.sql
```

---

## Database / SQL migration

Run the migrations **in numeric order** against your app's Postgres database. The
backend also creates these tables idempotently on startup (`ensure_schema*`), so
the files double as documentation of the canonical schema.

```bash
# all four, in order
for f in migrations/0001_*.sql migrations/0002_*.sql migrations/0003_*.sql migrations/0004_*.sql; do
  psql "$DATABASE_URL" -f "$f"
done
```

Dependency order matters: `0001` enables `pgcrypto` (needed by the vault in
`0004`); `0002` creates `users` (referenced by anything you add that ties rows to
a user).

The full schema:

```sql
-- 0001_extensions.sql — pgcrypto powers the encrypted vault.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 0002_users.sql — passwords are one-way bcrypt hashes, never reversible.
CREATE TABLE IF NOT EXISTS users (
    id            bigserial PRIMARY KEY,
    name          text NOT NULL,
    surname       text NOT NULL,
    email         text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- 0003_files.sql — metadata in PG, the binary lives on disk under STORAGE_DIR.
DO $$ BEGIN
    CREATE TYPE file_type AS ENUM ('document', 'image', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS files (
    id           bigserial PRIMARY KEY,
    name         text NOT NULL,
    type         file_type NOT NULL DEFAULT 'other',
    storage_path text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- 0004_vault.sql — secrets are read-backable, encrypted at rest with VAULT_KEY.
CREATE TABLE IF NOT EXISTS vault_secrets (
    name       text PRIMARY KEY,
    value      bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
```

**Storage vs. encryption — two different concerns:**

| Concern               | Where it lives                          | Reversible? |
| --------------------- | --------------------------------------- | ----------- |
| Login passwords       | `users.password_hash` (bcrypt)          | No (hash)   |
| Readable secrets      | `vault_secrets.value` (pgp_sym_encrypt) | Yes, with `VAULT_KEY` |
| Uploaded file binaries| disk under `STORAGE_DIR`                | n/a         |
| File metadata         | `files` table                           | n/a         |

---

## Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # then fill in the CHANGE_ME values
uvicorn app.main:app --reload --root-path /api
```

Endpoints out of the box: `/auth/login`, `/auth/logout`, `/auth/me`,
`/auth/change-password`, `/auth/users`, `/vault`, `/files`, plus `/health` and
`/ready`. Add your own routers in `app/main.py`. Required env vars are documented
in `backend/.env.example` (`DATABASE_URL`, `JWT_SECRET`, `VAULT_KEY`,
`STORAGE_DIR`, and the `SEED_USER_*` for the first user).

---

## Frontend — consuming the UI kit in an app

1. **Point the app at the registry.** Copy `components.json.example` to
   `components.json` in your app (e.g. `web/`) and keep the `@tillforty` registry
   entry.

2. **Use the shared theme.** In `tailwind.config.js`:

   ```js
   import tillforty from '@tillforty/app-boilerplate/tailwind-preset'
   export default {
     presets: [tillforty],
     content: ['./index.html', './src/**/*.{ts,tsx}'],
   }
   ```

3. **Pull the pieces** (shadcn primitives like `button`/`avatar` are resolved
   automatically as dependencies):

   ```bash
   npx shadcn@latest add @tillforty/theme
   npx shadcn@latest add @tillforty/auth
   npx shadcn@latest add @tillforty/app-shell
   ```

   Files land as editable source under `src/`. Edit **`src/config/app-config.tsx`**
   to set your brand (name, logo, initial) and nav items — that's the only file
   you're expected to customize in the shell.

4. **Wire it up** in your router:

   ```tsx
   import { AuthProvider } from '@/context/AuthContext'
   import ProtectedRoute from '@/components/ProtectedRoute'
   import AppLayout from '@/components/layout/AppLayout'
   // <AuthProvider> at the root; <ProtectedRoute> guarding <AppLayout> routes.
   ```

### Pulling updates later

Re-run the same `add` command. The CLI overwrites the tracked files, so review
the **git diff** and keep or discard each change — that's the "pull changes"
loop, no submodules involved.

```bash
npx shadcn@latest add @tillforty/app-shell   # then: git diff, reconcile
```

Pin to a release tag instead of `main` for stability — change the registry URL in
`components.json` to `.../app-boilerplate/v1.0.0/r/{name}.json`.

---

## Maintaining this repo

The `registry/*` files are the canonical source. After editing them, rebuild the
served JSON descriptors and commit:

```bash
npx shadcn@latest build      # registry.json → r/*.json
git add r/ && git commit -m "Rebuild registry"
git tag v1.0.0               # tag releases so apps can pin
```

Host the `r/` directory anywhere static (GitHub raw, GitHub Pages, or Vercel) and
make sure `components.json` in each app points at it.

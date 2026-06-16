# Tillforty App Boilerplate

A full-stack starter shared across Tillforty apps:

- **Frontend** — a [shadcn](https://ui.shadcn.com) **registry** of the Tillforty UI kit (theme, app shell, auth scaffold, API client). Consuming apps pull components in *as editable source* with the shadcn CLI and pull updates later as reviewable diffs.
- **Backend** — a FastAPI template with **users + JWT auth**, an **encrypted secret vault** (pgcrypto), and **file storage** (binaries on disk, metadata in Postgres).
- **Database** — the SQL migrations every app needs to provision the above.

```
app-boilerplate/
├─ .env.example         # consolidated env template (root, full-stack)
├─ registry/            # frontend source, distributed via the shadcn registry
│  ├─ theme/tokens.css      → src/index.css
│  ├─ lib/{utils,api,auth}.ts
│  ├─ config/app-config.tsx # << the one file each app edits (brand + nav)
│  └─ blocks/{auth,app-shell}/
├─ registry.json        # registry manifest (`shadcn build` → /r/*.json)
├─ tailwind-preset.js   # shared Tailwind theme preset
├─ components.json.example
├─ backend/             # FastAPI app: auth + roles + vault + files + vectors + llm
│  ├─ app/{db,security,auth,roles,vault,files,vectors,llm,main}.py
│  ├─ requirements.txt
│  └─ .env.example
└─ migrations/          # SQL — run in order
   ├─ 0001_extensions.sql
   ├─ 0002_users.sql
   ├─ 0003_files.sql
   ├─ 0004_vault.sql
   ├─ 0005_pgvector.sql
   └─ 0006_roles.sql
```

---

## Database / SQL migration

Run the migrations **in numeric order** against your app's Postgres database. The
backend also creates these tables idempotently on startup (`ensure_schema*`), so
the files double as documentation of the canonical schema.

```bash
# all of them, in order
for f in migrations/0*.sql; do
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

-- 0005_pgvector.sql — embedding columns + nearest-neighbour search. Embeddings
-- live on domain tables (no standalone table); column width = EMBEDDING_DIM.
CREATE EXTENSION IF NOT EXISTS vector;
```

**Storage vs. encryption — two different concerns:**

| Concern               | Where it lives                          | Reversible? |
| --------------------- | --------------------------------------- | ----------- |
| Login passwords       | `users.password_hash` (bcrypt)          | No (hash)   |
| Readable secrets      | `vault_secrets.value` (pgp_sym_encrypt) | Yes, with `VAULT_KEY` |
| Uploaded file binaries| disk under `STORAGE_DIR`                | n/a         |
| File metadata         | `files` table                           | n/a         |

---

## Environment variables

Copy the template and fill in every `CHANGE_ME` — generate secrets with
`openssl rand -hex 32`. There's a consolidated root template (`.env.example`,
docker-compose / full-stack style) and a backend-only one (`backend/.env.example`).

```bash
cp .env.example .env        # never commit the filled-in .env
```

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | API | Postgres DSN the API connects with. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Postgres | Provision the DB on first boot (match `DATABASE_URL`). |
| `JWT_SECRET` | API | Signs login tokens. **Rotating invalidates all sessions.** |
| `JWT_EXPIRE_MINUTES` | API | Token lifetime (default `720` = 12h). |
| `SEED_USER_*` | API | First user seeded on startup (name, surname, email, password). |
| `VAULT_KEY` | API | Symmetric key for the encrypted vault. **Rotating makes existing `vault_secrets` undecryptable.** |
| `STORAGE_DIR` | API | Disk path for uploaded file binaries — bind-mount to a persistent volume. |
| `EMBEDDING_MODEL` | API | Model that turns text into vectors for the pgvector store. |
| `EMBEDDING_DIM` | API | Vector dimension — **must match** the embedding model (`text-embedding-3-small` = 1536). |
| `EMBEDDING_API_KEY` | API | Key for the embedding provider. |
| `EMBEDDING_BASE_URL` | API | Optional provider base-URL override (Azure / proxy / self-hosted). |
| `OPERATING_AGENT_MODEL` | API | LLM powering the operating agent (reasoning / chat / tool use). |
| `OPERATING_AGENT_API_KEY` | API | Key for the operating-agent provider. |
| `OPERATING_AGENT_BASE_URL` | API | Optional provider base-URL override. |
| `VITE_API_PROXY_TARGET` | Web (dev) | Where the Vite dev server proxies `/api`. Prod uses the relative `/api`. |

## Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env      # or backend/.env.example — fill in the CHANGE_ME values
uvicorn app.main:app --reload --root-path /api
```

Endpoints out of the box: `/auth/login`, `/auth/logout`, `/auth/me`,
`/auth/change-password`, `/auth/users`, `/vault`, `/files`, plus `/health` and
`/ready`. Add your own routers in `app/main.py`. Required env vars are documented
in `backend/.env.example` (`DATABASE_URL`, `JWT_SECRET`, `VAULT_KEY`,
`STORAGE_DIR`, and the `SEED_USER_*` for the first user).

### Roles & permissions (RBAC)

Each user has one role (`users.role_id`); a role holds a set of permission keys
like `users:read` (the `*` wildcard grants everything). Two **system** roles are
seeded and cannot be deleted:

- **administrator** — `['*']`, can do anything; its permissions are locked.
- **member** — a limited demo set (`users:read`, `files:read`, `files:upload`), editable.

The selectable functions/actions live in `roles.py` `PERMISSION_CATALOG` — add an
entry there and it appears as checkboxes in the role editor. Guard any route:

```python
from app.roles import require_permission

@router.delete("/widgets/{id}")
async def delete_widget(id: int, _=Depends(require_permission("widgets:delete"))):
    ...
```

Endpoints: `GET /roles`, `POST /roles`, `GET/PATCH/DELETE /roles/{id}`,
`PUT /roles/assign`, `GET /roles/permissions` (the catalog), `GET /roles/me`
(your role + effective permissions). Deleting a system role → 403; deleting a
role still assigned to users → 409.

On the frontend, `pull` the `roles` block, then wrap your app in
`PermissionsProvider` (inside `AuthProvider`), gate UI with `<PermissionGate>` /
`usePermissions().can(...)`, and route `/settings/roles` → `RolesPage`:

```tsx
<AuthProvider>
  <PermissionsProvider>
    {/* ... */}
    <Route path="/settings/roles" element={<RolesPage />} />
    <PermissionGate permission="roles:manage"><AdminButton /></PermissionGate>
  </PermissionsProvider>
</AuthProvider>
```

### Embeddings + LLM

`app/vectors.py` installs pgvector on startup and exposes `to_vector(embedding)`
to format a float list as a pgvector literal (validated against `EMBEDDING_DIM`).
`app/llm.py` is a provider-agnostic client (OpenAI SDK; point `*_BASE_URL` at any
OpenAI-compatible endpoint). Embeddings go on your own domain tables — store with
`to_vector`, search with `<=>`:

```python
from app import llm, vectors

vec = vectors.to_vector(await llm.embed_one("some text"))
await db.get_pool().execute(
    "UPDATE products SET embedding = $2 WHERE id = $1", product_id, vec
)

answer = await llm.complete([
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Summarize this BOQ."},
])
```

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

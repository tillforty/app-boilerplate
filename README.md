# Tillforty App Boilerplate

A full-stack starter shared across Tillforty apps:

- **Frontend** — a [shadcn](https://ui.shadcn.com) **registry** of the Tillforty UI kit (theme, app shell, auth scaffold, API client). Consuming apps pull components in *as editable source* with the shadcn CLI and pull updates later as reviewable diffs.
- **Backend** — a FastAPI template with **users + JWT auth**, an **encrypted secret vault** (pgcrypto), and **file storage** (binaries on disk, metadata in Postgres).
- **Database** — the SQL migrations every app needs to provision the above.

---

## 🚀 Run the whole stack with one command

A Dockerized, self-contained runtime is included so the entire boilerplate —
Postgres (with pgcrypto + pgvector), the SQL migrations, the FastAPI backend, and
a real React (Vite) frontend built from the registry — launches with a single
command. The **only host requirement is Docker + the Compose plugin**.

```bash
./start.sh
```

On first run this:

1. Creates `.env` from `.env.example` and **auto-generates** the database password,
   `JWT_SECRET`, `VAULT_KEY`, and the seed admin password (printed once).
2. Builds the images and starts the services in order:
   **Postgres → migrations (run in numeric order) → API → web**.
3. Waits for the API's `/ready` check, then prints the URLs + admin login.

| Service | URL (default ports) |
| --- | --- |
| Web UI (React) | http://localhost:8080 |
| API (direct) | http://localhost:8000 |
| API docs (Swagger) | http://localhost:8080/api/docs — also linked from the UI |

> The API runs with `--root-path /api`, so Swagger UI loads its schema through the
> `/api` proxy. Use **http://localhost:8080/api/docs** (via the web service); the
> raw `:8000/docs` page can't resolve its `openapi.json` on its own.

Other commands:

```bash
./start.sh logs       # follow logs
./start.sh down       # stop everything (keeps the database + uploaded files)
./start.sh destroy    # stop AND delete the data volumes (full reset)
```

Override the host ports by editing `WEB_PORT` / `API_PORT` in `.env`. The LLM keys
(`EMBEDDING_API_KEY`, `OPERATING_AGENT_API_KEY`) are left as `CHANGE_ME` — the app
runs fine without them; fill them in `.env` to enable embeddings / the LLM agent.

**Public HTTPS deploy:** set `DOMAIN` (and `ACME_EMAIL`) in `.env` and `start.sh`
brings up an optional Caddy reverse proxy that auto-provisions a Let's Encrypt
certificate and serves the app at `https://<your-domain>`. See **[DEPLOY.md](DEPLOY.md)**.

What the runtime adds on top of the registry (all generated, editable source):

- **`web/`** — a Vite + React + TypeScript app that already consumes the registry
  blocks (theme, i18n, auth, app-shell, roles) with the shadcn UI primitives
  vendored in `web/src/components/ui`. Routes: `/login`, `/` (dashboard),
  `/profile`, `/settings/users`, `/settings/roles`, plus the OAuth callback.
- **`docker-compose.yml`**, **`backend/Dockerfile`**, **`web/Dockerfile`** +
  `web/nginx.conf` (serves the SPA and proxies `/api` to the backend).
- **`start.sh`** — the launcher above.

> Note: the sections below document the boilerplate as a **distributable registry +
> backend template** (pulling pieces into a separate app). The Docker runtime above
> is the batteries-included way to stand the whole thing up as one application.

---

```
app-boilerplate/
├─ .env.example         # consolidated env template (root, full-stack)
├─ registry/            # frontend source, distributed via the shadcn registry
│  ├─ theme/tokens.css      → src/index.css
│  ├─ lib/{utils,api,auth}.ts
│  ├─ config/app-config.tsx # << the one file each app edits (brand + nav)
│  ├─ i18n/                  # translations (en) + provider + language switcher
│  └─ blocks/{auth,app-shell,roles}/
├─ registry.json        # registry manifest (`shadcn build` → /r/*.json)
├─ tailwind-preset.js   # shared Tailwind theme preset
├─ components.json.example
├─ backend/             # FastAPI app: auth + oauth + roles + vault + files + vectors + llm
│  ├─ app/{db,security,auth,oauth,roles,vault,files,vectors,llm,main}.py
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

### Single sign-on (Google / Microsoft)

Optional and **config-driven**: set a provider's `CLIENT_ID` + `CLIENT_SECRET`
and its button automatically appears on the login screen (the frontend asks
`GET /auth/oauth/providers` which only returns configured providers). Leave them
blank and no button shows. Flow: `GET /auth/oauth/{provider}/login` → provider →
`GET /auth/oauth/{provider}/callback` → user matched/created by email (given the
`member` role), our JWT issued, browser redirected to `OAUTH_POST_LOGIN_URL` with
the token in the URL fragment.

Register this exact redirect URI in each provider console:
`{OAUTH_REDIRECT_BASE_URL}/api/auth/oauth/{google|microsoft}/callback`.

The `auth` block ships `LoginPage` (email/password + SSO buttons) and
`OAuthCallback`. Wire the callback route **outside** `ProtectedRoute`:

```tsx
<Route path="/login" element={<LoginPage />} />
<Route path="/auth/callback" element={<OAuthCallback />} />   {/* public */}
```

### API docs

FastAPI's interactive docs are served at **`/api/docs`** (run uvicorn with
`--root-path /api`). They're linked from the settings menu (`apiDocsUrl` in
`app-config.tsx`). To lock them down, pass `docs_url=None` to `FastAPI(...)` and
re-serve behind your own auth.

### Internationalization (i18n)

Dependency-free. Pull the `i18n` block, wrap your app in `I18nProvider`, and use
`t()` for copy. English (`src/i18n/en.ts`) is the default and the fallback for any
missing key.

```tsx
import { I18nProvider, useTranslation } from '@/i18n'

// <I18nProvider> at the root, then:
const { t } = useTranslation()
t('roles.title')                 // "Roles & permissions"
t('roles.editRole', { name })    // interpolates {name}
```

**Add a language:** copy `src/i18n/en.ts` to e.g. `lt.ts`, translate the values
(keep the keys), then register it in `src/i18n/index.tsx` (`dictionaries` +
`LANGUAGE_LABELS`). Drop `<LanguageSwitcher />` into the Header — it lists every
registered language and persists the choice to `localStorage` (`tf_lang`).

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
   to set your brand and nav — that's the only file you customize in the shell:

   - `brand.logoSrc` / `brand.name` / `brand.initial` — the system logo.
   - `brand.primary` — the system-wide primary color as HSL channels
     (`"H S% L%"`). Call `applyBrandTheme()` once in `main.tsx` so it applies
     everywhere (incl. the login screen); the app shell re-applies it on mount.
   - `nav` / `settingsNav` — menu items. The settings menu includes an **API
     Docs** entry (an `external` link to `apiDocsUrl`, default `/api/docs`).

   ```tsx
   // main.tsx
   import { applyBrandTheme } from '@/config/app-config'
   applyBrandTheme()
   ```

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

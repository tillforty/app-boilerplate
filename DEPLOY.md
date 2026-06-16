# Deploying the boilerplate

Two ways to run it:

- **Local** — `./start.sh` brings the stack up on `http://localhost:8080`. No domain, no TLS.
- **Public** — one command takes a fresh Linux server to a live HTTPS app (e.g.
  **app.tillforty.com**) with an auto-renewing Let's Encrypt certificate.

---

## 🚀 One-command deploy (fresh server)

Do these two manual things first — the script can't do them for you:

1. **DNS** — add an `A` record for your domain pointing at the server's public IP:
   `app.tillforty.com  A  <server-ip>`. Cert issuance fails until this resolves.
2. **Firewall** — open inbound TCP **80** and **443** (e.g. cloud security group
   and/or `ufw allow 80,443/tcp`). Both are required for ACME + TLS.

Then, **on the server** (as root, or a sudo user), run:

```bash
curl -fsSL https://raw.githubusercontent.com/tillforty/app-boilerplate/main/deploy.sh \
  | DOMAIN=app.tillforty.com ACME_EMAIL=ops@tillforty.com bash
```

Or **from your laptop** against a server you can SSH into — either the raw SSH
one-liner, or the `make` shortcut from a clone of this repo:

```bash
ssh root@SERVER 'curl -fsSL https://raw.githubusercontent.com/tillforty/app-boilerplate/main/deploy.sh \
  | DOMAIN=app.tillforty.com ACME_EMAIL=ops@tillforty.com bash'

# …or:
make deploy SERVER=root@SERVER DOMAIN=app.tillforty.com ACME_EMAIL=ops@tillforty.com
```

That's it. `deploy.sh` will:

1. Install **Docker + Compose** if missing (via `get.docker.com`) and `git`/`curl`.
2. Clone the repo to `/opt/app-boilerplate` (or `git pull` if already there).
3. Run `start.sh`, which generates `.env` + all secrets, bakes in `DOMAIN`
   (and sets `OAUTH_REDIRECT_BASE_URL=https://DOMAIN`), and brings up the stack
   **with the Caddy HTTPS proxy**.
4. Print the URLs and the **first-run admin login** (shown once — save it).

The first request to `https://app.tillforty.com` can take a few seconds while
Caddy completes the ACME handshake. Watch it with:

```bash
cd /opt/app-boilerplate
./start.sh logs            # all services
docker compose logs caddy  # cert issuance specifically
```

### Tunables (environment vars on the `deploy.sh` line)

| Var | Default | Purpose |
| --- | --- | --- |
| `DOMAIN` | _(unset)_ | Public hostname. Omit for a local-only HTTP run. |
| `ACME_EMAIL` | _(unset)_ | Let's Encrypt contact email (expiry notices). |
| `OAUTH_REDIRECT_BASE_URL` | `https://$DOMAIN` | Override if the public URL differs. |
| `GIT_URL` | this repo | Source repo to deploy. |
| `BRANCH` | `main` | Branch to deploy. |
| `APP_DIR` | `/opt/app-boilerplate` | Checkout location on the server. |

`deploy.sh` is **idempotent** — re-running it does `git pull` + rebuild and
preserves the database, uploaded files, and secrets. Use it as your update path too.

---

## How it fits together

```
Internet ──443──> caddy (TLS, Let's Encrypt)
                    └─> web (nginx) ──/──> SPA static files
                                     └─/api─> api (FastAPI) ──> postgres
```

Caddy only terminates TLS and forwards to the existing `web` container — SPA
serving and `/api` proxying are unchanged. `web` still publishes `:8080` for
direct/local access; firewall it off if the domain should be the only entry point.

Issued certs and the ACME account key live in the `caddy_data` Docker volume, so
restarts and redeploys reuse them (no re-issuance, no rate-limit risk).
**`./start.sh destroy` deletes all volumes including `caddy_data`** — only for a
full reset.

---

## Manual deploy (no script)

If you'd rather not pipe a script, do what `deploy.sh` does, by hand:

```bash
# On the server, with Docker + Compose already installed:
git clone https://github.com/tillforty/app-boilerplate.git /opt/app-boilerplate
cd /opt/app-boilerplate

# Bake the public config in and launch in one go:
DOMAIN=app.tillforty.com ACME_EMAIL=ops@tillforty.com ./start.sh
```

`start.sh` honors `DOMAIN`/`ACME_EMAIL`/`OAUTH_REDIRECT_BASE_URL` from the
environment **only when it first creates `.env`**. If `.env` already exists, edit
it directly:

```ini
DOMAIN=app.tillforty.com
ACME_EMAIL=ops@tillforty.com
OAUTH_REDIRECT_BASE_URL=https://app.tillforty.com   # if you enable SSO
```

then re-run `./start.sh`.

---

## Updating a running deploy

```bash
# Either re-run the one-liner (idempotent), or on the server:
cd /opt/app-boilerplate && git pull && ./start.sh
```

Data is preserved across updates. Deployment is intentionally **manual** (no
auto-deploy CI) — run the update when you want it shipped.

---

## Production checklist

- [ ] DNS `A` record for `$DOMAIN` resolves to the server.
- [ ] Inbound TCP 80 + 443 reachable (security group / `ufw allow 80,443/tcp`).
- [ ] `.env` has strong, generated secrets (the first `./start.sh` does this).
- [ ] `OAUTH_REDIRECT_BASE_URL=https://<domain>` and the matching callback URL is
      registered in each OAuth provider console (if SSO is enabled).
- [ ] SMTP configured (`SMTP_HOST`, …) if the app sends email.
- [ ] Consider firewalling the host's `:8080`/`:8000` so the domain is the only
      public entry point.
- [ ] Back up the `pgdata` and `storage` Docker volumes.

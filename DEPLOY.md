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
| `CADDY_TLS` | _(unset)_ | Origin TLS strategy. Blank = auto Let's Encrypt. `tls internal` = self-signed, for behind a proxy (see Cloudflare below). |
| `OAUTH_REDIRECT_BASE_URL` | `https://$DOMAIN` | Override if the public URL differs. |
| `GIT_URL` | this repo | Source repo to deploy. |
| `BRANCH` | `main` | Branch to deploy. |
| `APP_DIR` | `/opt/app-boilerplate` | Checkout location on the server. |
| `GITHUB_TOKEN` / `GH_TOKEN` | _(unset)_ | Token for cloning a **private** repo (`contents:read`). See below. |

`deploy.sh` is **idempotent** — re-running it does `git pull` + rebuild and
preserves the database, uploaded files, and secrets. Use it as your update path too.

**Updating later — just run `deploy`.** The first `deploy.sh` installs a
`/usr/local/bin/deploy` command on the server, so from then on updating the box is
one word:

```bash
deploy            # on the server: git pull + rebuild, data + secrets preserved
```

That's the everyday update path (no laptop checkout or `make deploy` needed). It
does a fast-forward `git pull`; if local edits to tracked files block it, commit
or discard them first (e.g. `git -C /opt/app-boilerplate checkout -- <file>`).

### Private repositories

If the source repo is **private**, two things need auth that a public repo doesn't:

1. **Fetching `deploy.sh`** — the `curl … | bash` one-liner pulls the script from
   `raw.githubusercontent.com`, which returns **404** for a private repo. Either
   download it with an auth header, or (simpler) clone the repo first and run
   `./deploy.sh` from the checkout.
2. **The clone/pull inside `deploy.sh`** — the script runs `git` as **root** via
   `sudo`, and root does *not* inherit your login user's credential helper (e.g.
   `~/.git-credentials`). Pass a token in the environment and it's injected into
   the HTTPS remote for the clone/fetch only (never written to the stored remote):

   ```bash
   # From a checkout of a private repo:
   sudo GITHUB_TOKEN=ghp_xxx DOMAIN=app.example.com ACME_EMAIL=ops@example.com ./deploy.sh

   # Or fetch the script with auth, then pipe:
   curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" \
     https://raw.githubusercontent.com/<owner>/<repo>/main/deploy.sh \
     | GITHUB_TOKEN=$GITHUB_TOKEN DOMAIN=app.example.com ACME_EMAIL=ops@example.com bash
   ```

   Use a fine-grained PAT scoped to the repo with **Contents: read**.

---

## Behind Cloudflare (or another TLS-terminating proxy)

If the domain is proxied through Cloudflare (orange-cloud), Let's Encrypt's
HTTP-01 challenge can't reach this origin, so **don't** use the default ACME mode.
Instead let the origin serve a self-signed cert and let Cloudflare terminate TLS
for the browser:

```bash
curl -fsSL https://raw.githubusercontent.com/tillforty/app-boilerplate/main/deploy.sh \
  | DOMAIN=app.tillforty.com CADDY_TLS="tls internal" bash
```

Then in the **Cloudflare dashboard**:

1. **DNS** → set the `app` `A` record to this server's IP, proxy **on** (orange).
2. **SSL/TLS** → **Overview** → set encryption mode to **Full**. (Cloudflare
   encrypts edge↔origin and accepts the origin's self-signed cert. Don't use
   *Flexible* — it leaves the origin leg unencrypted and can cause redirect loops;
   don't use *Full (strict)* unless you install a Cloudflare Origin Certificate.)

```
Browser ──HTTPS──> Cloudflare (public cert) ──HTTPS──> caddy (self-signed, :443)
                                                         └─> web ─> api ─> postgres
```

Because the origin cert is self-signed, you can deploy and verify the server
**before** repointing DNS — the stack comes up immediately; flipping Cloudflare
is the only remaining step. For a fully-validated chain instead, generate a
Cloudflare **Origin Certificate**, mount it, set `CADDY_TLS="tls /path/cert /path/key"`,
and use Cloudflare mode *Full (strict)*.

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

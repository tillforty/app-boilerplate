# Deploying the boilerplate (public HTTPS)

`./start.sh` runs the stack locally on `http://localhost:8080`. To expose it on a
real domain over HTTPS — e.g. **app.tillforty.com** as a live demo — set one env
var and `start.sh` brings up an optional [Caddy](https://caddyserver.com) reverse
proxy that obtains and renews a Let's Encrypt certificate automatically.

Nothing about the local flow changes: leave `DOMAIN` blank and you get the same
`localhost:8080` behavior as before.

## What you need

- A server (VPS / cloud VM) with **Docker + the Compose plugin** installed.
- Ports **80 and 443** open to the internet and free on the host (Caddy binds
  them for the ACME challenge and TLS). Nothing else must already use them.
- **DNS**: an `A` record for your domain pointing at the server's public IP, e.g.
  `app.tillforty.com  A  <server-ip>`. The cert can't be issued until this
  resolves to the box.

## Steps

```bash
# 1. On the server
git clone https://github.com/tillforty/app-boilerplate.git
cd app-boilerplate

# 2. First run generates .env + secrets (creates it from .env.example).
#    Run it once so the file exists, then edit it:
./start.sh down  >/dev/null 2>&1 || true   # no-op if nothing is running
[ -f .env ] || cp .env.example .env        # start.sh also does this on first up
```

Edit `.env` and set:

```ini
DOMAIN=app.tillforty.com
ACME_EMAIL=ops@tillforty.com               # for cert expiry notices
OAUTH_REDIRECT_BASE_URL=https://app.tillforty.com   # if you enable SSO
```

> If this is a brand-new clone, you can skip the manual copy: edit nothing,
> run `./start.sh` once to generate `.env` + secrets, then set the three values
> above and run `./start.sh` again.

Then launch:

```bash
./start.sh
```

Because `DOMAIN` is set, `start.sh` enables the `public` compose profile, starts
the `caddy` service alongside the rest, and prints `https://app.tillforty.com`.
The **first** request can take a few seconds while Caddy completes the ACME
handshake. If it stalls, check:

```bash
./start.sh logs            # all services
docker compose logs caddy  # cert issuance specifically
```

## How it fits together

```
Internet ──443──> caddy (TLS, Let's Encrypt)
                    └─> web (nginx) ──/──> SPA static files
                                     └─/api─> api (FastAPI) ──> postgres
```

Caddy only terminates TLS and forwards to the existing `web` container — the
SPA serving and `/api` proxying are unchanged. The `web` service still publishes
`:8080` on the host for direct/local access; firewall it off if you want the
domain to be the only entry point.

## Certificates persist

Issued certs and the ACME account key live in the `caddy_data` Docker volume, so
restarts and redeploys reuse them (no re-issuance, no rate-limit risk).
`./start.sh destroy` deletes **all** volumes including `caddy_data` — only use it
for a full reset.

## Updating the demo

```bash
git pull
./start.sh            # rebuilds changed images and restarts; data is preserved
```

To automate this on push to `main`, add a small webhook/Action that SSHes in and
runs the two commands above — not included here to keep the repo credential-free.

## Production checklist

- [ ] DNS `A` record resolves to the server.
- [ ] Ports 80/443 reachable (security group / `ufw allow 80,443`).
- [ ] `.env` has strong, generated secrets (the first `./start.sh` does this).
- [ ] `OAUTH_REDIRECT_BASE_URL=https://<domain>` and the same callback URL is
      registered in each OAuth provider console.
- [ ] Consider firewalling the host's `:8080`/`:8000` so the domain is the only
      public entry point.
- [ ] Back up the `pgdata` and `storage` volumes.

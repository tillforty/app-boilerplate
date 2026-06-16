# Tillforty app boilerplate — convenience wrapper.
#
# Local:
#   make up                 # build + start the stack locally (= ./start.sh)
#   make logs               # follow logs
#   make down               # stop (keeps data)
#   make destroy            # stop AND delete data volumes
#
# Remote (one command from your laptop — needs SSH access to the server):
#   make deploy SERVER=root@1.2.3.4 DOMAIN=app.tillforty.com ACME_EMAIL=ops@tillforty.com
#
# deploy SSHes in and runs deploy.sh: installs Docker if missing, clones/pulls the
# repo, and brings the stack up behind Caddy with auto HTTPS. Idempotent — re-run
# to update (git pull + rebuild, data preserved). See DEPLOY.md.

RAW_URL    ?= https://raw.githubusercontent.com/tillforty/app-boilerplate/main/deploy.sh
BRANCH     ?= main
ACME_EMAIL ?=

.DEFAULT_GOAL := help
.PHONY: help up logs down destroy deploy

help:
	@echo "Local:  make up | logs | down | destroy"
	@echo "Remote: make deploy SERVER=user@host DOMAIN=app.example.com [ACME_EMAIL=you@example.com]"

up:
	./start.sh

logs:
	./start.sh logs

down:
	./start.sh down

destroy:
	./start.sh destroy

deploy:
	@test -n "$(SERVER)" || { echo "ERROR: SERVER is required, e.g. make deploy SERVER=root@host DOMAIN=app.tillforty.com"; exit 1; }
	@test -n "$(DOMAIN)" || { echo "ERROR: DOMAIN is required, e.g. make deploy SERVER=root@host DOMAIN=app.tillforty.com"; exit 1; }
	@echo "▶ Deploying $(DOMAIN) to $(SERVER) (branch $(BRANCH))…"
	ssh $(SERVER) 'curl -fsSL $(RAW_URL) | DOMAIN=$(DOMAIN) ACME_EMAIL=$(ACME_EMAIL) BRANCH=$(BRANCH) bash'

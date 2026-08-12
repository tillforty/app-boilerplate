# Tillforty development agent runner.
#
# Everything the API container deliberately does NOT have: git, a Node runtime
# with the two coding CLIs, and a Docker client for rebuilding the host stack.
# It owns no HTTP surface — it polls `dev_jobs` / `dev_deployments` in Postgres.
FROM node:22-bookworm-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DEBIAN_FRONTEND=noninteractive

# git: clone/branch/push. bash+openssl+curl: what the host's start.sh expects.
# python3: the worker itself.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates curl bash openssl jq \
        python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Docker CLI + compose plugin. No daemon here — it drives the HOST daemon
# through the socket bind-mounted by docker-compose.yml.
RUN install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        > /etc/apt/sources.list.d/docker.list \
    && apt-get update && apt-get install -y --no-install-recommends \
        docker-ce-cli docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# The two coding agents. Which one runs is decided per job at runtime, from the
# provider bound to the `development_agent` function in app settings.
RUN npm install -g @anthropic-ai/claude-code @openai/codex \
    && npm cache clean --force

# Worker deps in a venv (Debian's python is PEP 668 externally-managed).
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir asyncpg==0.30.0 "httpx>=0.27,<0.29"
ENV PATH=/opt/venv/bin:$PATH

# The coding CLIs refuse to run fully-autonomous as root, and running arbitrary
# generated code as root would be careless anyway — so the agent step drops to
# this unprivileged user while the worker keeps the Docker socket access.
RUN useradd --create-home --shell /bin/bash agent \
    && mkdir -p /work && chown agent:agent /work

WORKDIR /app
COPY runner.py .

CMD ["python3", "runner.py"]

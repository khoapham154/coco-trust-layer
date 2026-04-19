#!/usr/bin/env bash
# setup_twenty.sh — idempotent bring-up of a local Twenty CRM instance.
#
# What it does:
#   1. Clones `twentyhq/twenty` into `<repo>/twenty/` if absent (pinned tag).
#   2. Copies `packages/twenty-docker/.env.example` to `.env` if missing.
#   3. Runs Twenty's own Docker Compose, waits for :3000 to come up.
#
# Usage:
#   bash scripts/setup_twenty.sh                 # clone + up
#   bash scripts/setup_twenty.sh --rebuild        # force rebuild
#   bash scripts/setup_twenty.sh --down           # tear down
#
# Rationale: Twenty is a 500MB monorepo, so we vendor it (gitignored)
# rather than forking. We never edit Twenty's source — the SDK is
# injected at runtime from the Twenty tab.

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
RESET='\033[0m'

info()  { printf "${YELLOW}[info]${RESET} %s\n" "$*"; }
ok()    { printf "${GREEN}[ok]${RESET}   %s\n" "$*"; }
fail()  { printf "${RED}[fail]${RESET} %s\n" "$*" 1>&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TWENTY_DIR="${REPO_ROOT}/twenty"
TWENTY_REMOTE="git@github.com:twentyhq/twenty.git"
# Pinned to a known-good release. Bump when Twenty ships a version we
# test against.
TWENTY_TAG="v0.32.0"
TWENTY_COMPOSE="${TWENTY_DIR}/packages/twenty-docker/docker-compose.yml"
TWENTY_ENV_EXAMPLE="${TWENTY_DIR}/packages/twenty-docker/.env.example"
TWENTY_ENV="${TWENTY_DIR}/packages/twenty-docker/.env"
TWENTY_URL="http://localhost:3000"
TWENTY_HEALTH="${TWENTY_URL}/healthz"
WAIT_SECS=90

MODE="up"
if [[ "${1:-}" == "--down" ]]; then MODE="down"; fi
if [[ "${1:-}" == "--rebuild" ]]; then MODE="rebuild"; fi

if ! command -v docker >/dev/null 2>&1; then
  fail "docker not found on PATH"
fi
if ! command -v git >/dev/null 2>&1; then
  fail "git not found on PATH"
fi

if [[ ! -d "${TWENTY_DIR}/.git" ]]; then
  info "Cloning ${TWENTY_REMOTE} at ${TWENTY_TAG} into ${TWENTY_DIR}"
  git clone --depth 1 --branch "${TWENTY_TAG}" "${TWENTY_REMOTE}" "${TWENTY_DIR}"
  ok "Cloned Twenty ${TWENTY_TAG}"
else
  ok "Twenty repo already present at ${TWENTY_DIR}"
fi

if [[ ! -f "${TWENTY_COMPOSE}" ]]; then
  fail "Twenty compose file not found: ${TWENTY_COMPOSE}"
fi

if [[ ! -f "${TWENTY_ENV}" ]]; then
  if [[ -f "${TWENTY_ENV_EXAMPLE}" ]]; then
    cp "${TWENTY_ENV_EXAMPLE}" "${TWENTY_ENV}"
    ok "Seeded Twenty .env from example"
  else
    info "No .env.example in upstream — writing minimal .env"
    cat > "${TWENTY_ENV}" <<'EOF'
TAG=latest
PG_DATABASE_USER=postgres
PG_DATABASE_PASSWORD=postgres
SERVER_URL=http://localhost:3000
APP_SECRET=replace-me-with-32-byte-secret
STORAGE_TYPE=local
EOF
  fi
fi

# Ensure SERVER_URL points at localhost (some versions default to an
# install-script-generated URL).
if grep -q '^SERVER_URL=' "${TWENTY_ENV}"; then
  sed -i.bak 's|^SERVER_URL=.*|SERVER_URL=http://localhost:3000|' "${TWENTY_ENV}" && rm -f "${TWENTY_ENV}.bak"
else
  echo "SERVER_URL=http://localhost:3000" >> "${TWENTY_ENV}"
fi

case "${MODE}" in
  down)
    info "Stopping Twenty stack"
    docker compose -f "${TWENTY_COMPOSE}" --env-file "${TWENTY_ENV}" down
    ok "Twenty stopped"
    exit 0
    ;;
  rebuild)
    info "Rebuilding Twenty stack (pull + up -d --build)"
    docker compose -f "${TWENTY_COMPOSE}" --env-file "${TWENTY_ENV}" pull || true
    docker compose -f "${TWENTY_COMPOSE}" --env-file "${TWENTY_ENV}" up -d --build
    ;;
  *)
    info "Starting Twenty stack"
    docker compose -f "${TWENTY_COMPOSE}" --env-file "${TWENTY_ENV}" up -d
    ;;
esac

info "Waiting up to ${WAIT_SECS}s for ${TWENTY_HEALTH}"
for i in $(seq 1 "${WAIT_SECS}"); do
  if curl -fsS --max-time 2 "${TWENTY_HEALTH}" >/dev/null 2>&1 \
    || curl -fsS --max-time 2 "${TWENTY_URL}" >/dev/null 2>&1; then
    ok "Twenty reachable at ${TWENTY_URL} (after ${i}s)"
    echo
    info "Next steps:"
    echo "  1. Open ${TWENTY_URL}, create an admin account"
    echo "  2. Settings → Developers → API → generate a personal token"
    echo "  3. export TWENTY_API_KEY=<token>"
    echo "  4. python scripts/seed_twenty.py"
    exit 0
  fi
  sleep 1
done

fail "Twenty did not come up within ${WAIT_SECS}s. Check: docker compose -f ${TWENTY_COMPOSE} logs --tail 100"

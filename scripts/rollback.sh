#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
    echo "Usage: $0 <git-ref>" >&2
    exit 1
fi

TARGET_REF="$1"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.prod.yml"
ENV_FILE="${ROOT_DIR}/.env.production"

if [[ ! -f "${ENV_FILE}" ]]; then
    echo "Missing ${ENV_FILE}." >&2
    exit 1
fi

cd "${ROOT_DIR}"
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Working tree has uncommitted changes. Commit/stash before rollback." >&2
    exit 1
fi

PREVIOUS_REF="$(git rev-parse --short HEAD)"

echo "[rollback] Checking out ${TARGET_REF}..."
git fetch --all --tags --prune
git checkout "${TARGET_REF}"

echo "[rollback] Re-deploying services..."
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --build --remove-orphans

echo "[rollback] Done. Previous ref was ${PREVIOUS_REF}."

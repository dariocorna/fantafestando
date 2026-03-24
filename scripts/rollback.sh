#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.prod.yml"
ENV_FILE="${ROOT_DIR}/.env.production"
TARGET_REF=""
SKIP_CLEANUP=false

usage() {
    echo "Usage: $0 <git-ref> [--skip-cleanup]" >&2
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-cleanup) SKIP_CLEANUP=true; shift ;;
        -h|--help) usage; exit 0 ;;
        -*)
            echo "Unknown option: $1" >&2
            usage
            exit 1
            ;;
        *)
            if [[ -z "${TARGET_REF}" ]]; then
                TARGET_REF="$1"
                shift
            else
                echo "Unexpected argument: $1" >&2
                usage
                exit 1
            fi
            ;;
    esac
done

if [[ -z "${TARGET_REF}" ]]; then
    usage
    exit 1
fi

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

if [[ "${SKIP_CLEANUP}" == "false" ]]; then
    bash "${ROOT_DIR}/scripts/docker-post-deploy-cleanup.sh"
fi

echo "[rollback] Done. Previous ref was ${PREVIOUS_REF}."

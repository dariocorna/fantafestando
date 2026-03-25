#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.prod.yml"
ENV_FILE="${ROOT_DIR}/.env.production"
BUNDLE_FILE=""
FORCE=false
RESTORE_MONGO=true
RESTORE_UPLOADS=true
RESTORE_ENV=false
STOP_APP_SERVICES=true
SERVICES_RESTART_REQUIRED=false
stopped_services=()

usage() {
  cat <<'USAGE'
Usage: ./scripts/restore-runtime.sh <bundle.tar.gz> [options]

Options:
  --compose-file <path>  Docker compose file (default: docker-compose.prod.yml)
  --env-file <path>      Runtime env file (default: .env.production)
  --mongo-only           Restore only MongoDB
  --uploads-only         Restore only public/uploads
  --restore-env          Restore the env file included in the bundle
  --skip-app-stop        Do not stop backoffice/menu during restore
  --force                Required to run the destructive restore
  -h, --help             Show this help
USAGE
}

log() {
  echo "[restore-runtime] $*"
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

wait_for_container_state() {
  local container_id="$1"
  local desired_desc="$2"
  local attempts="${3:-60}"
  local i
  local status

  for (( i=1; i<=attempts; i++ )); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"
    case "${status}" in
      healthy|running)
        return 0
        ;;
    esac
    sleep 2
  done

  echo "Timed out waiting for ${desired_desc} (${container_id})." >&2
  return 1
}

cleanup() {
  local exit_code=$?

  if [[ "${SERVICES_RESTART_REQUIRED}" == "true" ]] && (( ${#stopped_services[@]} > 0 )); then
    if declare -p compose_cmd >/dev/null 2>&1; then
      log "Restore exited early, attempting to restart application services: ${stopped_services[*]}"
      "${compose_cmd[@]}" start "${stopped_services[@]}" >/dev/null 2>&1 || true
    fi
  fi

  if [[ -n "${tmp_dir:-}" && -d "${tmp_dir}" ]]; then
    rm -rf "${tmp_dir}"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --compose-file) COMPOSE_FILE="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --mongo-only) RESTORE_MONGO=true; RESTORE_UPLOADS=false; shift ;;
    --uploads-only) RESTORE_MONGO=false; RESTORE_UPLOADS=true; shift ;;
    --restore-env) RESTORE_ENV=true; shift ;;
    --skip-app-stop) STOP_APP_SERVICES=false; shift ;;
    --force) FORCE=true; shift ;;
    -h|--help) usage; exit 0 ;;
    -* ) echo "Unknown option: $1" >&2; usage; exit 1 ;;
    * )
      if [[ -z "${BUNDLE_FILE}" ]]; then
        BUNDLE_FILE="$1"
        shift
      else
        echo "Unexpected argument: $1" >&2
        usage
        exit 1
      fi
      ;;
  esac
done

if [[ -z "${BUNDLE_FILE}" ]]; then
  usage
  exit 1
fi

require_cmd docker
require_cmd tar
require_cmd mktemp
require_cmd cp
require_cmd rm

if [[ ! -f "${BUNDLE_FILE}" ]]; then
  echo "Backup bundle not found: ${BUNDLE_FILE}" >&2
  exit 1
fi

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "Compose file not found: ${COMPOSE_FILE}" >&2
  exit 1
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/fantafestando-restore.XXXXXX")"
trap cleanup EXIT

tar -xzf "${BUNDLE_FILE}" -C "${tmp_dir}"
bundle_root="$(find "${tmp_dir}" -mindepth 1 -maxdepth 1 -type d | head -n1)"
if [[ -z "${bundle_root}" ]]; then
  echo "Unable to read bundle contents from ${BUNDLE_FILE}" >&2
  exit 1
fi

manifest_file="${bundle_root}/manifest.env"
if [[ ! -f "${manifest_file}" ]]; then
  echo "Bundle manifest missing: ${manifest_file}" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${manifest_file}"

if [[ "${BACKUP_FORMAT:-}" != "runtime-bundle-v1" ]]; then
  echo "Unsupported backup format: ${BACKUP_FORMAT:-unknown}" >&2
  exit 1
fi

if [[ -f "${bundle_root}/SHA256SUMS" ]] && command -v sha256sum >/dev/null 2>&1; then
  log "Verifying bundle checksums..."
  (cd "${bundle_root}" && sha256sum -c SHA256SUMS >/dev/null)
fi

if [[ "${RESTORE_MONGO}" == "false" && "${RESTORE_UPLOADS}" == "false" ]]; then
  echo "Restore must include at least one of MongoDB or uploads." >&2
  exit 1
fi

if [[ "${RESTORE_MONGO}" == "true" && "${INCLUDE_MONGO:-false}" != "true" ]]; then
  echo "The selected bundle does not contain a MongoDB archive." >&2
  exit 1
fi

if [[ "${RESTORE_UPLOADS}" == "true" && "${INCLUDE_UPLOADS:-false}" != "true" ]]; then
  echo "The selected bundle does not contain an uploads archive." >&2
  exit 1
fi

if [[ "${RESTORE_ENV}" == "true" && "${INCLUDE_ENV:-false}" != "true" ]]; then
  echo "The selected bundle does not contain a runtime env file." >&2
  exit 1
fi

if [[ "${FORCE}" != "true" ]]; then
  log "Refusing destructive restore without --force."
  log "Bundle: ${BUNDLE_FILE}"
  log "Created: ${CREATED_AT:-unknown}"
  log "Contents: mongo=${INCLUDE_MONGO:-false}, uploads=${INCLUDE_UPLOADS:-false}, env=${INCLUDE_ENV:-false}"
  exit 1
fi

if [[ "${RESTORE_ENV}" == "true" ]]; then
  env_copy_path="${bundle_root}/${ENV_FILE_COPY:-}"
  if [[ ! -f "${env_copy_path}" ]]; then
    echo "Runtime env file missing in bundle: ${env_copy_path}" >&2
    exit 1
  fi
  mkdir -p "$(dirname "${ENV_FILE}")"
  cp "${env_copy_path}" "${ENV_FILE}"
  log "Restored env file to ${ENV_FILE}"
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Use --restore-env if the bundle contains the runtime env file." >&2
  exit 1
fi

compose_cmd=(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")
if [[ -n "${COMPOSE_PROJECT_NAME:-}" ]]; then
  compose_cmd+=(-p "${COMPOSE_PROJECT_NAME}")
fi

if [[ "${STOP_APP_SERVICES}" == "true" ]]; then
  for service in fantafestando-backoffice fantafestando-menu; do
    if "${compose_cmd[@]}" ps --status running --services 2>/dev/null | grep -qx "${service}"; then
      stopped_services+=("${service}")
    fi
  done

  if (( ${#stopped_services[@]} > 0 )); then
    log "Stopping application services: ${stopped_services[*]}"
    "${compose_cmd[@]}" stop "${stopped_services[@]}"
    SERVICES_RESTART_REQUIRED=true
  fi
fi

mongo_container="$("${compose_cmd[@]}" ps -q mongo || true)"
if [[ "${RESTORE_MONGO}" == "true" ]]; then
  if [[ -z "${mongo_container}" ]]; then
    log "Starting mongo service..."
    "${compose_cmd[@]}" up -d mongo
    mongo_container="$("${compose_cmd[@]}" ps -q mongo)"
  fi

  wait_for_container_state "${mongo_container}" "mongo service"
  log "Restoring MongoDB archive..."
  "${compose_cmd[@]}" exec -T mongo sh -lc '
    mongorestore       --username "$MONGO_INITDB_ROOT_USERNAME"       --password "$MONGO_INITDB_ROOT_PASSWORD"       --authenticationDatabase admin       --db "$MONGO_INITDB_DATABASE"       --archive --gzip --drop
  ' < "${bundle_root}/${MONGO_ARCHIVE}"

  COMPOSE_FILE="${COMPOSE_FILE}" ENV_FILE="${ENV_FILE}" bash "${ROOT_DIR}/scripts/migrate-order-pickup-index.sh"
fi

if [[ "${RESTORE_UPLOADS}" == "true" ]]; then
  uploads_extract_dir="${tmp_dir}/uploads-restore"
  mkdir -p "${uploads_extract_dir}"
  tar -xzf "${bundle_root}/${UPLOADS_ARCHIVE}" -C "${uploads_extract_dir}"
  if [[ ! -d "${uploads_extract_dir}/uploads" ]]; then
    echo "uploads directory missing inside ${UPLOADS_ARCHIVE}" >&2
    exit 1
  fi

  log "Restoring public/uploads..."
  rm -rf "${ROOT_DIR}/public/uploads"
  mkdir -p "${ROOT_DIR}/public"
  cp -a "${uploads_extract_dir}/uploads" "${ROOT_DIR}/public/uploads"
  chmod -R a+rwX "${ROOT_DIR}/public/uploads" || true
fi

if (( ${#stopped_services[@]} > 0 )); then
  log "Starting application services: ${stopped_services[*]}"
  "${compose_cmd[@]}" start "${stopped_services[@]}"
  SERVICES_RESTART_REQUIRED=false

  for service in "${stopped_services[@]}"; do
    container_id="$("${compose_cmd[@]}" ps -q "${service}" || true)"
    if [[ -n "${container_id}" ]]; then
      wait_for_container_state "${container_id}" "service ${service}" 45
    fi
  done
fi

backoffice_container="$("${compose_cmd[@]}" ps -q fantafestando-backoffice || true)"
mongo_container="$("${compose_cmd[@]}" ps -q mongo || true)"
if [[ -n "${backoffice_container}" && -n "${mongo_container}" ]]; then
  if "${compose_cmd[@]}" ps --status running --services 2>/dev/null | grep -qx 'fantafestando-backoffice'; then
    bash "${ROOT_DIR}/scripts/verify-upload-assets.sh" "${backoffice_container}" "${mongo_container}"
  fi
fi

"${compose_cmd[@]}" ps
log "Restore completed from ${BUNDLE_FILE}"

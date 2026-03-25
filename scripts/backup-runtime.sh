#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.prod.yml"
ENV_FILE="${ROOT_DIR}/.env.production"
OUTPUT_DIR="${ROOT_DIR}/backups"
BACKUP_PREFIX="fantafestando-runtime-backup"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
KEEP_COUNT=0
INCLUDE_MONGO=true
INCLUDE_UPLOADS=true
INCLUDE_ENV=false

usage() {
  cat <<'USAGE'
Usage: ./scripts/backup-runtime.sh [options]

Options:
  --output-dir <dir>     Destination directory for backup bundles (default: ./backups)
  --compose-file <path>  Docker compose file (default: docker-compose.prod.yml)
  --env-file <path>      Runtime env file (default: .env.production)
  --prefix <name>        Backup file prefix (default: fantafestando-runtime-backup)
  --keep <n>             Keep only the newest n bundles matching the prefix
  --mongo-only           Backup only MongoDB
  --uploads-only         Backup only public/uploads
  --include-env          Include a copy of the runtime env file in the bundle
  -h, --help             Show this help
USAGE
}

log() {
  echo "[backup-runtime] $*"
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

read_env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "${ENV_FILE}" | tail -n1
}

prune_old_bundles() {
  local prefix="$1"
  local keep_count="$2"
  local output_dir="$3"
  local -a bundles=()
  local remove_count=0
  local i

  if (( keep_count <= 0 )); then
    return 0
  fi

  while IFS= read -r bundle; do
    bundles+=("${bundle}")
  done < <(find "${output_dir}" -maxdepth 1 -type f -name "${prefix}-*.tar.gz" | LC_ALL=C sort)

  if (( ${#bundles[@]} <= keep_count )); then
    return 0
  fi

  remove_count=$(( ${#bundles[@]} - keep_count ))
  for (( i=0; i<remove_count; i++ )); do
    log "Pruning old bundle ${bundles[$i]}"
    rm -f -- "${bundles[$i]}"
  done
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir) OUTPUT_DIR="${2:-}"; shift 2 ;;
    --compose-file) COMPOSE_FILE="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --prefix) BACKUP_PREFIX="${2:-}"; shift 2 ;;
    --keep) KEEP_COUNT="${2:-}"; shift 2 ;;
    --mongo-only) INCLUDE_MONGO=true; INCLUDE_UPLOADS=false; shift ;;
    --uploads-only) INCLUDE_MONGO=false; INCLUDE_UPLOADS=true; shift ;;
    --include-env) INCLUDE_ENV=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

require_cmd docker
require_cmd tar
require_cmd sed
require_cmd find
require_cmd mktemp

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}." >&2
  exit 1
fi

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "Compose file not found: ${COMPOSE_FILE}" >&2
  exit 1
fi

if ! [[ "${KEEP_COUNT}" =~ ^[0-9]+$ ]]; then
  echo "--keep must be an integer >= 0" >&2
  exit 1
fi

if [[ "${INCLUDE_MONGO}" == "false" && "${INCLUDE_UPLOADS}" == "false" ]]; then
  echo "Backup must include at least one of MongoDB or uploads." >&2
  exit 1
fi

cd "${ROOT_DIR}"
mkdir -p "${OUTPUT_DIR}"

compose_cmd=(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")
if [[ -n "${COMPOSE_PROJECT_NAME:-}" ]]; then
  compose_cmd+=(-p "${COMPOSE_PROJECT_NAME}")
fi

host_name="$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo unknown-host)"
backup_created_at="$(date '+%Y-%m-%dT%H:%M:%S%z')"
app_version="$(read_env_value APP_VERSION)"
app_build="$(read_env_value APP_BUILD)"
mongo_database="$(read_env_value MONGO_DATABASE)"
if [[ -z "${mongo_database}" ]]; then
  mongo_database="fantafestando"
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/fantafestando-backup.XXXXXX")"
trap 'rm -rf "${tmp_dir}"' EXIT

bundle_dir_name="${BACKUP_PREFIX}-${TIMESTAMP}"
staging_dir="${tmp_dir}/${bundle_dir_name}"
mkdir -p "${staging_dir}"

mongo_archive_name="mongo.archive.gz"
uploads_archive_name="uploads.tar.gz"
manifest_file="${staging_dir}/manifest.env"
checksums_file="${staging_dir}/SHA256SUMS"
output_bundle="${OUTPUT_DIR}/${bundle_dir_name}.tar.gz"

env_copy_name=""
if [[ "${INCLUDE_ENV}" == "true" ]]; then
  env_copy_name="$(basename "${ENV_FILE}")"
fi

if [[ "${INCLUDE_MONGO}" == "true" ]]; then
  if ! "${compose_cmd[@]}" ps --status running --services | grep -qx 'mongo'; then
    echo "Mongo service is not running. Start the production stack before taking a backup." >&2
    exit 1
  fi

  log "Dumping MongoDB (${mongo_database})..."
  "${compose_cmd[@]}" exec -T mongo sh -lc '
    mongodump       --username "$MONGO_INITDB_ROOT_USERNAME"       --password "$MONGO_INITDB_ROOT_PASSWORD"       --authenticationDatabase admin       --db "$MONGO_INITDB_DATABASE"       --archive --gzip
  ' > "${staging_dir}/${mongo_archive_name}"
fi

if [[ "${INCLUDE_UPLOADS}" == "true" ]]; then
  log "Archiving public/uploads..."
  if [[ -d "${ROOT_DIR}/public/uploads" ]]; then
    tar -C "${ROOT_DIR}/public" -czf "${staging_dir}/${uploads_archive_name}" uploads
  else
    mkdir -p "${tmp_dir}/empty/uploads"
    tar -C "${tmp_dir}/empty" -czf "${staging_dir}/${uploads_archive_name}" uploads
  fi
fi

if [[ "${INCLUDE_ENV}" == "true" ]]; then
  log "Copying runtime env file into bundle..."
  cp "${ENV_FILE}" "${staging_dir}/${env_copy_name}"
fi

{
  echo "BACKUP_FORMAT=runtime-bundle-v1"
  echo "CREATED_AT=${backup_created_at}"
  echo "HOSTNAME=${host_name}"
  echo "PROJECT_ROOT_BASENAME=$(basename "${ROOT_DIR}")"
  echo "COMPOSE_FILE_BASENAME=$(basename "${COMPOSE_FILE}")"
  echo "ENV_FILE_BASENAME=$(basename "${ENV_FILE}")"
  echo "INCLUDE_MONGO=${INCLUDE_MONGO}"
  echo "INCLUDE_UPLOADS=${INCLUDE_UPLOADS}"
  echo "INCLUDE_ENV=${INCLUDE_ENV}"
  if [[ -n "${app_version}" ]]; then
    echo "APP_VERSION=${app_version}"
  fi
  if [[ -n "${app_build}" ]]; then
    echo "APP_BUILD=${app_build}"
  fi
  if [[ "${INCLUDE_MONGO}" == "true" ]]; then
    echo "MONGO_DATABASE=${mongo_database}"
    echo "MONGO_ARCHIVE=${mongo_archive_name}"
  fi
  if [[ "${INCLUDE_UPLOADS}" == "true" ]]; then
    echo "UPLOADS_ARCHIVE=${uploads_archive_name}"
  fi
  if [[ "${INCLUDE_ENV}" == "true" ]]; then
    echo "ENV_FILE_COPY=${env_copy_name}"
  fi
} > "${manifest_file}"

if command -v sha256sum >/dev/null 2>&1; then
  (
    cd "${staging_dir}"
    sha256sum "manifest.env" > "${checksums_file}"
    if [[ -f "${mongo_archive_name}" ]]; then
      sha256sum "${mongo_archive_name}" >> "${checksums_file}"
    fi
    if [[ -f "${uploads_archive_name}" ]]; then
      sha256sum "${uploads_archive_name}" >> "${checksums_file}"
    fi
    if [[ -n "${env_copy_name}" && -f "${env_copy_name}" ]]; then
      sha256sum "${env_copy_name}" >> "${checksums_file}"
    fi
  )
fi

log "Writing bundle ${output_bundle}..."
tar -C "${tmp_dir}" -czf "${output_bundle}" "${bundle_dir_name}"
prune_old_bundles "${BACKUP_PREFIX}" "${KEEP_COUNT}" "${OUTPUT_DIR}"

log "Backup completed."
log "Bundle: ${output_bundle}"
if [[ "${INCLUDE_MONGO}" == "true" ]]; then
  log "Included MongoDB archive: ${mongo_archive_name}"
fi
if [[ "${INCLUDE_UPLOADS}" == "true" ]]; then
  log "Included uploads archive: ${uploads_archive_name}"
fi
if [[ "${INCLUDE_ENV}" == "true" ]]; then
  log "Included env copy: ${env_copy_name}"
fi

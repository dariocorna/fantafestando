#!/usr/bin/env bash
set -euo pipefail

IMAGE_PRUNE="${DOCKER_IMAGE_PRUNE:-true}"
IMAGE_PRUNE_FILTER="${DOCKER_IMAGE_PRUNE_FILTER:-until=168h}"
BUILDER_PRUNE="${DOCKER_BUILDER_PRUNE:-true}"
BUILDER_PRUNE_FILTER="${DOCKER_BUILDER_PRUNE_FILTER:-until=48h}"

normalize_bool() {
  case "${1,,}" in
    1|on|true|yes) echo "true" ;;
    *) echo "false" ;;
  esac
}

if [[ "$(normalize_bool "${IMAGE_PRUNE}")" == "true" ]]; then
  echo "[cleanup] Pruning unused Docker images with filter ${IMAGE_PRUNE_FILTER}..."
  if ! docker image prune -af --filter "${IMAGE_PRUNE_FILTER}"; then
    echo "[cleanup] Warning: docker image prune failed." >&2
  fi
else
  echo "[cleanup] Skipping unused image prune."
fi

if [[ "$(normalize_bool "${BUILDER_PRUNE}")" == "true" ]]; then
  echo "[cleanup] Pruning Docker build cache with filter ${BUILDER_PRUNE_FILTER}..."
  if ! docker builder prune -af --filter "${BUILDER_PRUNE_FILTER}"; then
    echo "[cleanup] Warning: docker builder prune failed." >&2
  fi
else
  echo "[cleanup] Skipping Docker build cache prune."
fi

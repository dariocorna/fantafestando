#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
    echo "Usage: $0 <backoffice-container> <mongo-container>" >&2
    exit 1
fi

BACKOFFICE_CONTAINER="$1"
MONGO_CONTAINER="$2"

if [[ -z "${BACKOFFICE_CONTAINER}" || -z "${MONGO_CONTAINER}" ]]; then
    echo "[verify] Missing container ids." >&2
    exit 1
fi

DOCKER=(docker)
if ! "${DOCKER[@]}" ps >/dev/null 2>&1; then
    if command -v sudo >/dev/null 2>&1 && sudo -n docker ps >/dev/null 2>&1; then
        DOCKER=(sudo docker)
    else
        echo "[verify] Docker daemon is not available." >&2
        exit 1
    fi
fi

inspect_env_value() {
    local container="$1"
    local key="$2"

    "${DOCKER[@]}" inspect "${container}" --format '{{range .Config.Env}}{{println .}}{{end}}' \
        | sed -n "s/^${key}=//p" \
        | tail -n1
}

MONGO_ROOT_USERNAME="$(inspect_env_value "${MONGO_CONTAINER}" "MONGO_INITDB_ROOT_USERNAME")"
MONGO_ROOT_PASSWORD="$(inspect_env_value "${MONGO_CONTAINER}" "MONGO_INITDB_ROOT_PASSWORD")"
MONGO_DATABASE="$(inspect_env_value "${MONGO_CONTAINER}" "MONGO_INITDB_DATABASE")"

if [[ -z "${MONGO_ROOT_USERNAME}" ]]; then
    MONGO_ROOT_USERNAME="root"
fi

if [[ -z "${MONGO_DATABASE}" ]]; then
    MONGO_DATABASE="fantafestando"
fi

if [[ -z "${MONGO_ROOT_PASSWORD}" ]]; then
    echo "[verify] Missing MONGO_INITDB_ROOT_PASSWORD in ${MONGO_CONTAINER}." >&2
    exit 1
fi

echo "[verify] Checking upload routes in production manifest..."
"${DOCKER[@]}" exec "${BACKOFFICE_CONTAINER}" node -e '
const manifest = require("/app/.next/server/app-paths-manifest.json");
const keys = new Set(Object.keys(manifest));
const requiredRoutes = [
  "/uploads/[...path]/route",
];
const missing = requiredRoutes.filter((route) => !keys.has(route));
if (missing.length > 0) {
  console.error("[verify] Missing upload routes:");
  for (const route of missing) {
    console.error(`- ${route}`);
  }
  process.exit(1);
}
console.log("[verify] Upload routes present in manifest.");
'

echo "[verify] Checking active upload URLs..."
ACTIVE_UPLOADS_JSON="$(
    "${DOCKER[@]}" exec "${MONGO_CONTAINER}" mongosh --quiet \
        "mongodb://${MONGO_ROOT_USERNAME}:${MONGO_ROOT_PASSWORD}@localhost:27017/${MONGO_DATABASE}?authSource=admin" \
        --eval '
          const event = db.events.findOne({ active: true, archived: { $ne: true } }, { settings: 1 });
          print(JSON.stringify({
            menuHeaderLogoUrl: event?.settings?.menuHeaderLogoUrl || "",
            receiptHeaderLogoUrl: event?.settings?.receiptHeaderLogoUrl || "",
          }));
        '
)"

if [[ -z "${ACTIVE_UPLOADS_JSON}" ]]; then
    echo "[verify] No active event settings found; skipping asset URL check."
    exit 0
fi

"${DOCKER[@]}" exec "${BACKOFFICE_CONTAINER}" node -e '
const uploads = JSON.parse(process.argv[1]);
const entries = Object.entries(uploads).filter(([, url]) => typeof url === "string" && url.startsWith("/uploads/") && url.length > 0);
if (entries.length === 0) {
  console.log("[verify] No active upload URLs configured.");
  process.exit(0);
}

(async () => {
  for (const [label, url] of entries) {
    const response = await fetch("http://127.0.0.1:3000" + url);
    if (!response.ok) {
      console.error(`[verify] ${label} unreachable: ${url} -> ${response.status}`);
      process.exit(1);
    }
    console.log(`[verify] ${label} reachable: ${url} -> ${response.status}`);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
' "${ACTIVE_UPLOADS_JSON}"

echo "[verify] Upload asset checks passed."

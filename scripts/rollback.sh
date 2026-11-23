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

BUILD_SHA="$(git rev-parse --short HEAD)"
BUILD_DATE="$(git show -s --format=%cs HEAD)"
compose=(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")
"${compose[@]}" build
node_in_image=("${compose[@]}" run --rm --no-deps -T --pull never --entrypoint node fantafestando-backoffice)
VERSION="$("${node_in_image[@]}" -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).version' < package.json)"
EXPECTED_RELEASE="v${VERSION} (${BUILD_SHA} - ${BUILD_DATE})"

# Compose may read the service environment from a different file than the one
# it uses for interpolation. Persist the release where the services read it.
runtime_env="$("${compose[@]}" config --environment | sed -n 's/^APP_RUNTIME_ENV_FILE=//p')"
runtime_env="$(realpath -e -- "${runtime_env:-${ENV_FILE}}")"
temp_env="$(mktemp -- "${runtime_env}.XXXXXX")"
trap 'rm -f -- "${temp_env}"' EXIT
cp -p -- "${runtime_env}" "${temp_env}"
env_editor="$(cat <<'NODE'
const fs = require("node:fs");
const [version, build, date] = process.argv.slice(1);
const values = new Map([["APP_VERSION", version], ["APP_BUILD", build], ["APP_BUILD_DATE", date]]);
const seen = new Set();
let env = fs.readFileSync(0, "utf8");
const newline = env.includes("\r\n") ? "\r\n" : "\n";
// Match complete assignments so a quoted multiline value can contain other key names.
const assignment = /^([ \t]*(?:export[ \t]+)?([\w.-]+)[ \t]*=[ \t]*)("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[^#\r\n]*?)(?=[ \t]*(?:#|\r?$))/gm;
env = env.replace(assignment, (original, prefix, key) => {
    if (!values.has(key)) return original;
    seen.add(key);
    return prefix + values.get(key);
});
for (const [key, value] of values) {
    if (seen.has(key)) continue;
    if (env && !env.endsWith("\n")) env += newline;
    env += key + "=" + value + newline;
}
process.stdout.write(env);
NODE
)"
"${node_in_image[@]}" -e "${env_editor}" "${VERSION}" "${BUILD_SHA}" "${BUILD_DATE}" < "${runtime_env}" > "${temp_env}"
mv -- "${temp_env}" "${runtime_env}"

echo "[rollback] Re-deploying services at ${EXPECTED_RELEASE}..."
"${compose[@]}" up -d --no-build --remove-orphans --wait

for service in fantafestando-backoffice fantafestando-menu; do
    running_release="$("${compose[@]}" exec -T "${service}" node -e '
        fetch("http://127.0.0.1:3000/api/health").then(async response => {
            if (!response.ok) throw new Error("Health check HTTP " + response.status);
            console.log((await response.json()).release);
        }).catch(error => { console.error(error.message); process.exitCode = 1; });
    ')"
    if [[ "${running_release}" != "${EXPECTED_RELEASE}" ]]; then
        echo "[rollback] ${service} reports '${running_release}', expected '${EXPECTED_RELEASE}'." >&2
        exit 1
    fi
done

if [[ "${SKIP_CLEANUP}" == "false" ]]; then
    bash "${ROOT_DIR}/scripts/docker-post-deploy-cleanup.sh"
fi

echo "[rollback] Done. Previous ref was ${PREVIOUS_REF}."

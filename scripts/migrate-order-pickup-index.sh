#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.prod.yml"
ENV_FILE="${ROOT_DIR}/.env.production"

if [[ ! -f "${ENV_FILE}" ]]; then
    echo "Missing ${ENV_FILE}. Cannot run order index migration." >&2
    exit 1
fi

set -a
. "${ENV_FILE}"
set +a

if [[ -z "${MONGO_ROOT_USERNAME:-}" || -z "${MONGO_ROOT_PASSWORD:-}" || -z "${MONGODB_URI:-}" ]]; then
    echo "Missing one of required variables: MONGO_ROOT_USERNAME, MONGO_ROOT_PASSWORD, MONGODB_URI" >&2
    exit 1
fi

echo "[db-migration] Ensuring partial unique index on orders(eventId, pickupNumber)..."
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T mongo \
    mongosh --quiet \
    --username "${MONGO_ROOT_USERNAME}" \
    --password "${MONGO_ROOT_PASSWORD}" \
    --authenticationDatabase admin \
    "${MONGODB_URI}" \
    --eval '
const idxName = "eventId_1_pickupNumber_1";
const isTarget = (idx) => idx && idx.name === idxName;
const isCorrect = (idx) =>
  Boolean(
    idx &&
    idx.unique === true &&
    idx.partialFilterExpression &&
    idx.partialFilterExpression.pickupNumber &&
    idx.partialFilterExpression.pickupNumber.$type === "number"
  );

const existing = db.orders.getIndexes().find(isTarget);
if (existing && !isCorrect(existing)) {
  print("[db-migration] Dropping outdated index " + idxName);
  db.orders.dropIndex(idxName);
}

const current = db.orders.getIndexes().find(isTarget);
if (!isCorrect(current)) {
  print("[db-migration] Creating index " + idxName);
  db.orders.createIndex(
    { eventId: 1, pickupNumber: 1 },
    {
      name: idxName,
      unique: true,
      partialFilterExpression: { pickupNumber: { $type: "number" } }
    }
  );
}

print("[db-migration] Final index definition:");
printjson(db.orders.getIndexes().find(isTarget));
'

echo "[db-migration] Order pickup index migration completed."

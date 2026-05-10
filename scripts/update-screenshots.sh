#!/usr/bin/env zsh
set -euo pipefail

ROOT_DIR=${0:A:h:h}
MONGO_CONTAINER=helpdesk-mongo-screenshots
MONGO_PORT=27018
SCREENSHOT_MONGO_URI="mongodb://localhost:${MONGO_PORT}"
SCREENSHOT_MONGO_DB=helpdesk_screenshots
BACKEND_PORT=18081
BASE_URL="http://localhost:${BACKEND_PORT}"
BACKEND_LOG="${ROOT_DIR}/.tmp-screenshots-backend.log"
BACKEND_BIN="${ROOT_DIR}/.tmp-helpdesk-screenshots"

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
  fi
  if lsof -ti tcp:${BACKEND_PORT} >/dev/null 2>&1; then
    kill $(lsof -ti tcp:${BACKEND_PORT}) >/dev/null 2>&1 || true
  fi
  docker rm -f "${MONGO_CONTAINER}" >/dev/null 2>&1 || true
  rm -f "${BACKEND_BIN}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if lsof -ti tcp:${BACKEND_PORT} >/dev/null 2>&1; then
  echo "[screenshots] stopping process on port ${BACKEND_PORT}"
  kill $(lsof -ti tcp:${BACKEND_PORT}) >/dev/null 2>&1 || true
fi

echo "[screenshots] starting isolated MongoDB on port ${MONGO_PORT}"
docker rm -f "${MONGO_CONTAINER}" >/dev/null 2>&1 || true
docker run --rm --name "${MONGO_CONTAINER}" -p "${MONGO_PORT}:27017" -d mongo:7 >/dev/null

echo "[screenshots] building frontend for embedded backend UI"
cd "${ROOT_DIR}"
mise run build-frontend

echo "[screenshots] seeding isolated database"
cd "${ROOT_DIR}/backend"
env MONGO_URI="${SCREENSHOT_MONGO_URI}" MONGO_DB="${SCREENSHOT_MONGO_DB}" go run ./cmd/mockseed

echo "[screenshots] starting backend on :${BACKEND_PORT}"
set -a
source "${ROOT_DIR}/.env"
set +a
go build -o "${BACKEND_BIN}" ./cmd/helpdesk
env MONGO_URI="${SCREENSHOT_MONGO_URI}" MONGO_DB="${SCREENSHOT_MONGO_DB}" LISTEN_ADDR=":${BACKEND_PORT}" "${BACKEND_BIN}" > "${BACKEND_LOG}" 2>&1 &
BACKEND_PID=$!

for _ in {1..40}; do
  if curl -sS -o /dev/null "${BASE_URL}/api/v1/settings/public"; then
    break
  fi
  sleep 0.5
done

if ! curl -sS -o /dev/null "${BASE_URL}/api/v1/settings/public"; then
  echo "[screenshots] backend did not become ready; see ${BACKEND_LOG}"
  exit 1
fi

echo "[screenshots] capturing screenshots as admin"
cd "${ROOT_DIR}/frontend"
BASE_URL="${BASE_URL}" SCREENSHOT_EMAIL="mock-admin@tynsoe.org" SCREENSHOT_PASSWORD="Mock1234!" npm run screenshots

echo "[screenshots] done"

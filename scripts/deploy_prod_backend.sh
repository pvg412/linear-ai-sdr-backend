#!/usr/bin/env bash

###########    HOW TO USE    ###########
# chmod +x deploy_prod.sh
#
# Export environment variables:
# export SSH_KEY=~/.ssh/ai-sdr
# export REMOTE_HOST=YOUR_SERVER_IP
# export REMOTE_USER=root
# export REMOTE_DIR=/root/opt/ai-sdr-backend
# export IMAGE_REPO=ai-sdr-backend
#
# (optional) Tag:
# TAG=2025-11-28_01-23 ./deploy_prod.sh
#########################################

set -Eeuo pipefail
IFS=$'\n\t'

SSH_KEY="${SSH_KEY:-$HOME/.ssh/ai-sdr}"
IMAGE_REPO="${IMAGE_REPO:-ai-sdr-backend}"
APP_NAME="${APP_NAME:-ai-sdr-backend}"
REMOTE_HOST="${REMOTE_HOST:-1.2.3.4}"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_PORT="${REMOTE_PORT:-22}"
REMOTE_DIR="${REMOTE_DIR:-/root/opt/ai-sdr-backend}"
REMOTE_TMP="${REMOTE_TMP:-/tmp}"
STABLE_TAG="${STABLE_TAG:-current}"

TAG="${TAG:-$(date -u +%Y%m%d-%H%M%S)}"

log() { printf '\n[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }
trap 'fail "failed at line $LINENO"' ERR
need_cmd() { command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"; }

SSH_OPTS=(-i "$SSH_KEY" -p "$REMOTE_PORT" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
SCP_OPTS=(-i "$SSH_KEY" -P "$REMOTE_PORT" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new)

need_cmd docker
need_cmd gzip
need_cmd ssh
need_cmd scp

[ -f "$SSH_KEY" ] || fail "SSH key not found at $SSH_KEY"
chmod 600 "$SSH_KEY" || true

log "Checking remote Docker & Docker Compose..."
ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" \
  'docker --version >/dev/null && docker compose version >/dev/null' \
  || fail "Remote host must have Docker & Docker Compose installed (or SSH key not authorized)."

log "Ensuring docker buildx is ready..."
if ! docker buildx inspect >/dev/null 2>&1; then
  docker buildx create --use >/dev/null
fi

FULL_TAG="${IMAGE_REPO}:${TAG}"
TAR_NAME="${APP_NAME}_${TAG}_amd64.tar.gz"
TAR_LOCAL="/tmp/${TAR_NAME}"
TAR_REMOTE="${REMOTE_TMP}/${TAR_NAME}"

log "Building image ${FULL_TAG} for linux/amd64..."
docker buildx build --platform linux/amd64 -t "${FULL_TAG}" --load .

log "Saving image to ${TAR_LOCAL}..."
docker save "${FULL_TAG}" | gzip > "${TAR_LOCAL}"

log "Copying ${TAR_LOCAL} to ${REMOTE_USER}@${REMOTE_HOST}:${TAR_REMOTE} ..."
scp "${SCP_OPTS[@]}" "${TAR_LOCAL}" "${REMOTE_USER}@${REMOTE_HOST}:${TAR_REMOTE}"

log "Deploying on remote server..."
ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" bash -s <<EOF
set -Eeuo pipefail

echo "[remote] Loading image..."
gunzip -c "${TAR_REMOTE}" | docker load

echo "[remote] Tagging ${FULL_TAG} -> ${IMAGE_REPO}:${STABLE_TAG} ..."
if docker image inspect "${IMAGE_REPO}:${STABLE_TAG}" >/dev/null 2>&1; then
  docker tag "${IMAGE_REPO}:${STABLE_TAG}" "${IMAGE_REPO}:previous" || true
fi
docker tag "${FULL_TAG}" "${IMAGE_REPO}:${STABLE_TAG}"

echo "[remote] Removing uploaded tar..."
rm -f "${TAR_REMOTE}"

echo "[remote] docker compose up -d ..."
cd "${REMOTE_DIR}"
docker compose -f docker-compose.prod.yml up -d --force-recreate

echo "[remote] Pruning dangling images..."
docker image prune -f >/dev/null || true

echo "[remote] Done."
EOF

log "Cleaning local tar ${TAR_LOCAL} ..."
rm -f "${TAR_LOCAL}"

log "SUCCESS: Deployed ${FULL_TAG} as ${IMAGE_REPO}:${STABLE_TAG}"

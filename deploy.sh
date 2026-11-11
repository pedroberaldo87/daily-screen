#!/usr/bin/env bash
set -euo pipefail

# ── Config ─────────────────���────────────────���───
# Required: set these before running (env vars or export)
DEPLOY_HOST="${DEPLOY_HOST:?Set DEPLOY_HOST to your VPS IP or hostname}"
DEPLOY_KEY="${DEPLOY_KEY:?Set DEPLOY_KEY to the path of your SSH private key}"
# Optional: defaults provided
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/daily-screen}"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
TARBALL="/tmp/daily-screen-deploy.tar.gz"

SSH_CMD="ssh -i $DEPLOY_KEY -o StrictHostKeyChecking=no $DEPLOY_USER@$DEPLOY_HOST"

echo "═══ Daily Screen — Deploy ═══"

# ── 0. Build image locally ──
# The VPS is shared and never builds: a build there starved its memory and took other apps down (2026-11-05).
echo "→ Building image locally from commit $(git -C "$APP_DIR" rev-parse --short HEAD)..."
BUILD_CTX="$(mktemp -d)"
trap 'rm -rf "$BUILD_CTX"' EXIT
git -C "$APP_DIR" archive HEAD | tar -x -C "$BUILD_CTX"
docker build --platform linux/amd64 -t daily-screen-app:latest "$BUILD_CTX"

# ── 1. Create tarball ──
echo "→ Creating tarball..."
tar -czf "$TARBALL" \
  -C "$APP_DIR" \
  --exclude='node_modules' \
  --exclude='*.db' \
  --exclude='*.db-shm' \
  --exclude='*.db-wal' \
  --exclude='.claude' \
  --exclude='.git' \
  --exclude='.env' \
  .

echo "  Tarball: $(du -h "$TARBALL" | cut -f1)"

# ── 2. Upload to VPS ──
echo "→ Uploading to VPS..."
scp -i "$DEPLOY_KEY" -o StrictHostKeyChecking=no "$TARBALL" "$DEPLOY_USER@$DEPLOY_HOST:/tmp/daily-screen-deploy.tar.gz"
docker save daily-screen-app:latest | gzip | $SSH_CMD 'docker load'

# ── 3. Extract, restart on VPS ──
echo "→ Deploying on VPS..."
$SSH_CMD bash -s <<REMOTE
set -euo pipefail

# Scoped cleanup
echo "→ Pruning old Docker resources (scoped)..."
docker image prune -f
docker container prune -f

# Back up .env before overwriting
cp "$DEPLOY_PATH/docker/.env" /tmp/daily-screen-env-backup 2>/dev/null || true

# Extract
mkdir -p "$DEPLOY_PATH"
tar -xzf "$TARBALL" -C "$DEPLOY_PATH"

# Restore .env
cp /tmp/daily-screen-env-backup "$DEPLOY_PATH/docker/.env" 2>/dev/null || true

# Restart with the uploaded image
cd "$DEPLOY_PATH/docker"
docker compose up -d --no-build

# Health check
echo "→ Waiting for container..."
sleep 5
if docker ps --filter "name=daily-screen-app" --filter "status=running" -q | grep -q .; then
  echo "��� Container running"
else
  echo "✗ Container not running!"
  docker logs daily-screen-app --tail 20
  exit 1
fi

# Post-build cleanup
echo "→ Pruning post-build resources (scoped)..."
docker image prune -f

# Cleanup
rm -f "$TARBALL" /tmp/daily-screen-env-backup

echo "═══ Deploy complete ═══"
REMOTE

# ── 4. Cleanup local ──
rm -f "$TARBALL"
echo "✓ Done"

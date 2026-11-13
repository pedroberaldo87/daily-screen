#!/usr/bin/env bash
set -euo pipefail

# ── Config ──────────────────────────────────────
# Required: set these before running (env vars or export)
DEPLOY_HOST="${DEPLOY_HOST:?Set DEPLOY_HOST to your VPS IP or hostname}"
DEPLOY_KEY="${DEPLOY_KEY:?Set DEPLOY_KEY to the path of your SSH private key}"
# Optional: defaults provided
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/daily-screen}"
# known_hosts file that holds the VPS host key (pin it once, see README "Pin the server host key")
DEPLOY_KNOWN_HOSTS="${DEPLOY_KNOWN_HOSTS:-$HOME/.ssh/known_hosts}"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"

# Host key verification stays on: an unknown or changed key aborts the deploy.
if [ ! -s "$DEPLOY_KNOWN_HOSTS" ]; then
  echo "✗ $DEPLOY_KNOWN_HOSTS is missing or empty. Pin the server host key first (see README)." >&2
  exit 1
fi
SSH_OPTS=(-i "$DEPLOY_KEY" -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$DEPLOY_KNOWN_HOSTS")
REMOTE="$DEPLOY_USER@$DEPLOY_HOST"

# Local scratch space (build context + tarball), private to this run.
WORK_DIR="$(mktemp -d)"
TARBALL="$WORK_DIR/daily-screen-deploy.tar.gz"
# Private staging dir on the VPS (mode 700, created in step 2); empty until then.
REMOTE_STAGE=""

cleanup() {
  rm -rf "$WORK_DIR"
  # Best effort: the remote script removes the stage dir itself; this covers failures before it runs.
  if [ -n "$REMOTE_STAGE" ]; then
    printf 'rm -rf %q\n' "$REMOTE_STAGE" | ssh "${SSH_OPTS[@]}" "$REMOTE" bash -s >/dev/null 2>&1 || true
  fi
}
trap 'cleanup' EXIT

echo "═══ Daily Screen — Deploy ═══"

# ── 0. Build image locally ──
# The VPS is shared and never builds: a build there starved its memory and took other apps down (2026-11-05).
echo "→ Building image locally from commit $(git -C "$APP_DIR" rev-parse --short HEAD)..."
# The image and the tarball both come from this committed snapshot, so they always match.
if [ -n "$(git -C "$APP_DIR" status --porcelain)" ]; then
  echo "! Warning: uncommitted changes in $APP_DIR are NOT deployed (only commit $(git -C "$APP_DIR" rev-parse --short HEAD) is)." >&2
fi
BUILD_CTX="$WORK_DIR/context"
mkdir "$BUILD_CTX"
git -C "$APP_DIR" archive HEAD | tar -x -C "$BUILD_CTX"
docker build --platform linux/amd64 -t daily-screen-app:latest "$BUILD_CTX"

# ── 1. Create tarball ──
echo "→ Creating tarball from the same commit..."
# COPYFILE_DISABLE keeps macOS tar from adding AppleDouble "._*" files (they ended up on the VPS on 2026-11-13).
COPYFILE_DISABLE=1 tar -czf "$TARBALL" \
  -C "$BUILD_CTX" \
  --exclude='._*' \
  --exclude='.DS_Store' \
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
# Stage in a private directory (umask 077 gives mode 700), never at a fixed path in the shared /tmp.
echo "→ Uploading to VPS..."
REMOTE_STAGE="$(ssh "${SSH_OPTS[@]}" "$REMOTE" 'umask 077 && mktemp -d')"
if ! [[ "$REMOTE_STAGE" =~ ^/[A-Za-z0-9._/-]+$ ]]; then
  echo "✗ Unexpected staging path from server: '$REMOTE_STAGE'" >&2
  REMOTE_STAGE=""
  exit 1
fi
scp "${SSH_OPTS[@]}" "$TARBALL" "$REMOTE:$REMOTE_STAGE/daily-screen-deploy.tar.gz"
docker save daily-screen-app:latest | gzip | ssh "${SSH_OPTS[@]}" "$REMOTE" 'docker load'

# ── 3. Extract, restart on VPS ──
# The values are sent as quoted assignments (printf %q) ahead of a quoted heredoc, so nothing
# is expanded or word-split by the remote shell.
echo "→ Deploying on VPS..."
{
  printf 'DEPLOY_PATH=%q\nSTAGE=%q\n' "$DEPLOY_PATH" "$REMOTE_STAGE"
  cat <<'REMOTE_SCRIPT'
set -euo pipefail

trap 'rm -rf "$STAGE"' EXIT

# One-off migration: older deploys left these fixed-path files in /tmp (a copy of docker/.env and
# the upload). Remove them so the secret does not outlive the upgrade.
rm -f /tmp/daily-screen-env-backup /tmp/daily-screen-deploy.tar.gz

# Scoped cleanup
echo "→ Pruning old Docker resources (scoped)..."
docker image prune -f
docker container prune -f

# Back up .env before overwriting. The deploy fails if the backup cannot be written.
if [ ! -f "$DEPLOY_PATH/docker/.env" ]; then
  echo "✗ $DEPLOY_PATH/docker/.env not found. Create it on the server first (see README)." >&2
  exit 1
fi
(umask 077 && cp -p "$DEPLOY_PATH/docker/.env" "$STAGE/env-backup")

# Extract (default umask: the app tree must stay readable by whoever runs the stack)
mkdir -p "$DEPLOY_PATH"
tar -xzf "$STAGE/daily-screen-deploy.tar.gz" -C "$DEPLOY_PATH"

# Restore .env
cp -p "$STAGE/env-backup" "$DEPLOY_PATH/docker/.env"

# Restart with the uploaded image
cd "$DEPLOY_PATH/docker"
docker compose up -d --no-build

# Health check
echo "→ Waiting for container..."
sleep 5
if docker ps --filter "name=daily-screen-app" --filter "status=running" -q | grep -q .; then
  echo "✓ Container running"
else
  echo "✗ Container not running!"
  docker logs daily-screen-app --tail 20
  exit 1
fi

# Post-deploy cleanup (the trap removes the staging dir with the tarball and the .env backup)
echo "→ Pruning post-deploy resources (scoped)..."
docker image prune -f

echo "═══ Deploy complete ═══"
REMOTE_SCRIPT
} | ssh "${SSH_OPTS[@]}" "$REMOTE" bash -s

# ── 4. Cleanup ──
# The remote script already removed its staging dir; the EXIT trap removes the local scratch dir.
REMOTE_STAGE=""
echo "✓ Done"

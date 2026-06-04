#!/usr/bin/env bash
# RepairOS E2E launcher
# Builds the frontend (if needed), starts both servers, runs all tests, then stops.
#
# Usage:
#   bash e2e/run_e2e.sh          # full run (build + test)
#   bash e2e/run_e2e.sh --skip-build  # skip npm build (use existing .next/standalone)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$REPO_ROOT/backend"
FRONTEND="$REPO_ROOT/frontend"
STANDALONE="$FRONTEND/.next/standalone"

SKIP_BUILD=false
[[ "${1:-}" == "--skip-build" ]] && SKIP_BUILD=true

cleanup() {
    echo ""
    echo "Stopping servers…"
    [[ -n "${BACKEND_PID:-}" ]]  && kill "$BACKEND_PID"  2>/dev/null || true
    [[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
    wait 2>/dev/null || true
    echo "Done."
}
trap cleanup EXIT INT TERM

# ── 1. Build frontend ─────────────────────────────────────────────────────────
if [[ "$SKIP_BUILD" == false ]]; then
    echo "Building frontend…"
    cd "$FRONTEND"
    NEXT_PUBLIC_API_URL=http://localhost:8000 npm run build
    cp -r .next/static    "$STANDALONE/.next/static"
    cp -r public          "$STANDALONE/public"
    echo "Build done ✓"
fi

# ── 2. Start backend ──────────────────────────────────────────────────────────
echo "Starting backend (e2e settings)…"
cd "$BACKEND"
DJANGO_SETTINGS_MODULE=config.settings.e2e python manage.py runserver 8000 \
    --noreload 2>&1 | sed 's/^/[backend] /' &
BACKEND_PID=$!

# ── 3. Start frontend ─────────────────────────────────────────────────────────
echo "Starting frontend (standalone)…"
cd "$STANDALONE"
HOSTNAME=0.0.0.0 PORT=3000 node server.js 2>&1 | sed 's/^/[frontend] /' &
FRONTEND_PID=$!

# ── 4. Run tests ──────────────────────────────────────────────────────────────
cd "$REPO_ROOT"
python e2e/test_all_modules.py
EXIT_CODE=$?

exit $EXIT_CODE

#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export SESSION_SECRET="${SESSION_SECRET:-e2e-session-secret-at-least-32-chars}"
npm run start --workspace @personal-ledger/api &
API_PID=$!
npm run dev --workspace @personal-ledger/web &
WEB_PID=$!
trap 'kill $API_PID $WEB_PID 2>/dev/null || true' EXIT
while kill -0 $API_PID 2>/dev/null && kill -0 $WEB_PID 2>/dev/null; do sleep 2; done
wait $API_PID $WEB_PID 2>/dev/null || true

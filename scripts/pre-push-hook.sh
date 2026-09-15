#!/usr/bin/env bash
# pre-push hook — Fase 5a (a) + Fase 5b paso 0 (auditor):
# 1) STALE dist no se puede pushear (lección del 14-sep).
# 2) El bundle referenciado en dist/index.html DEBE estar trackeado en git y
#    ser idéntico al de HEAD (incidencia 15-sep: prod sirvió 404, pantalla negra).
set -u
REPO="$(git rev-parse --show-toplevel)"
cd "$REPO"

./scripts/check-dist-fresh.sh || {
  echo ""
  echo "PRE-PUSH BLOQUEADO: dist STALE — recompila (npm run build) y reintenta."
  exit 1
}

expected=$(grep -oE 'index-[A-Za-z0-9_-]+\.js' packages/client/dist/index.html 2>/dev/null | head -1)
if [ -n "$expected" ]; then
  if ! git ls-files --error-unmatch "packages/client/dist/assets/$expected" >/dev/null 2>&1; then
    echo ""
    echo "PRE-PUSH BLOQUEADO: bundle $expected NO está trackeado en git."
    echo "El tarball de prod servirá 404. Fix: git add -f packages/client/dist/assets/$expected"
    exit 1
  fi
  git_blob=$(git show "HEAD:packages/client/dist/assets/$expected" 2>/dev/null | shasum -a 256 | cut -d' ' -f1)
  disk_blob=$(shasum -a 256 "packages/client/dist/assets/$expected" | cut -d' ' -f1)
  if [ "$git_blob" != "$disk_blob" ]; then
    echo ""
    echo "PRE-PUSH BLOQUEADO: $expected en HEAD ≠ dist local — agrega el bundle nuevo:"
    echo "  git add -f packages/client/dist/assets/$expected && git commit --amend --no-edit"
    exit 1
  fi
  echo "OK: bundle $expected trackeado y fresco en HEAD"
fi

#!/usr/bin/env bash
# Fase 5a (auditor, lección 1 del 14-sep): chequeo AUTOMATIZADO de dist fresco.
# Falla si packages/*/dist es más viejo que su src — la disciplina no basta.
# Uso: ./scripts/check-dist-fresh.sh   (exit 0 = fresco, exit 1 = STALE)
set -u
cd "$(dirname "$0")/.."
fail=0
for pkg in packages/server packages/client; do
  [ -d "$pkg/dist" ] || { echo "FALTA dist: $pkg/dist"; fail=1; continue; }
  # comparar contra el ARCHIVO dist más nuevo (el mtime del DIR no se toca al
  # recompilar in-place — bug detectado el 14-sep con tsc)
  newest_src=$(find "$pkg/src" -type f -name '*.ts' -newer "$pkg/dist/index.js" -print -quit 2>/dev/null)
  if [ -n "$newest_src" ]; then
    echo "STALE: $pkg/dist es más viejo que $newest_src — recompilar antes de push/deploy"
    fail=1
  else
    echo "OK: $pkg/dist fresco"
  fi
done
# Cliente: el bundle indexado debe existir en dist/assets
expected=$(grep -oE 'index-[A-Za-z0-9_-]+\.js' packages/client/dist/index.html 2>/dev/null | head -1)
if [ -n "$expected" ] && [ ! -f "packages/client/dist/assets/$expected" ]; then
  echo "STALE: packages/client/dist/index.html apunta a $expected pero no existe en assets/"
  fail=1
fi
exit $fail

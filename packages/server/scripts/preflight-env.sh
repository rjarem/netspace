#!/usr/bin/env bash
# PREFLIGHT del entorno de gates/regresión (GrooveRadius).
# Verifica TODO lo que ha fallado repetidamente ANTES de correr suites.
# Uso: bash scripts/preflight-env.sh [--fix]
#   --fix: intenta levantar lo que falte (livekit, static servers).
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FIX="${1:-}"
FAIL=0

# 1) Server de juego en :2567 — debe estar vivo (o se deja que cada suite lo suba)
if curl -s -m 2 -o /dev/null http://localhost:2567/api/health 2>/dev/null; then
  echo "OK   server :2567 vivo (NOTA: si no lo reiniciaste tras un rebuild, está sirviendo dist VIEJO)"
else
  echo "WARN server :2567 caído — cada suite debe subir el suyo con env completo"
fi

# 2) LiveKit local :7880 — CAUSA #1 de fails falsos (8.1-e vol:-1, cámara ciclo6)
if curl -s -m 2 -o /dev/null http://localhost:7880/ 2>/dev/null; then
  echo "OK   livekit :7880 vivo"
else
  echo "FAIL livekit :7880 CAÍDO → 8.1-e y cámara de ciclo6 fallarán sin ser regresión"
  FAIL=1
  if [ "$FIX" = "--fix" ]; then
    docker rm -f gr-livekit-gate >/dev/null 2>&1
    docker run -d --name gr-livekit-gate --network host livekit/livekit-server --dev >/dev/null 2>&1 \
      && sleep 4 && echo "  FIX: livekit levantado" && FAIL=0
  fi
fi

# 3) Static servers :5173 y :4175 — CAUSA #2 ("antesala no pasó" / ERR_CONNECTION_REFUSED)
for PORT in 5173 4175; do
  if curl -s -m 2 -o /dev/null "http://localhost:$PORT/" 2>/dev/null; then
    echo "OK   static :$PORT vivo"
  else
    echo "FAIL static :$PORT CAÍDO → todos los gates chrome fallarán"
    FAIL=1
    if [ "$FIX" = "--fix" ]; then
      (cd "$ROOT/packages/client/dist" && nohup python3 -m http.server "$PORT" >/dev/null 2>&1 &) \
        && sleep 1 && echo "  FIX: static :$PORT levantado"
    fi
  fi
done

# 4) ADMIN_TOKEN en el entorno — CAUSA #3 (401s falsos "e2 list" en ciclo5/otros)
if [ -n "${ADMIN_TOKEN:-}" ]; then
  echo "OK   ADMIN_TOKEN presente en env"
else
  echo "FAIL ADMIN_TOKEN NO exportado → suites con minteo darán 401 falsos"
  echo "     exporta: export ADMIN_TOKEN=dev-admin"
  FAIL=1
fi

# 5) Procesos node server viejos (dist recién rebuild + server viejo = probar código viejo)
STALE=$(pgrep -fc "node dist/index" 2>/dev/null || true)
if [ "${STALE:-0}" -gt 0 ] && [ -n "$(find "$ROOT/packages/server/dist" -newer /proc/$(pgrep -f 'node dist/index' | head -1)/cmdline 2>/dev/null | head -1)" ]; then
  echo "WARN hay un server :2567 corriendo un dist MÁS VIEJO que el dist actual — reinícialo"
fi

echo "---"
if [ "$FAIL" -eq 0 ]; then echo "PREFLIGHT OK — entorno listo"; else echo "PREFLIGHT CON FALTANTES — corrige arriba (o usa --fix)"; fi
exit $FAIL

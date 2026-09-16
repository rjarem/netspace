#!/usr/bin/env bash
# run-gates.sh — Fase 3 gates A+B+C+D contra el server local (:2567).
# Re-ejecutable. Requiere: server colyseus local vivo con DEV_NO_AUTH=1,
# dist del cliente servido en :4175 (python3 -m http.server en packages/client/dist),
# firefox headless. Imprime PASS/FAIL por gate y exit 0 solo si TODOS pasan.
set -u
# Endurecer runner (deuda de tooling, auditor Fase 8): firefox zombies de
# corridas previas causaban splits intermitentes (round 4/5, "2 salas").
pkill -9 -f firefox 2>/dev/null && sleep 2 || true
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(dirname "$SCRIPT_DIR")"   # run-gates.sh vive en el repo root; su padre no — corregir abajo
cd "$SCRIPT_DIR"                  # repo root = donde está el propio script
LOG=${GR_LOG:-/tmp/gr-server.log}
URL=${PROBE_URL:-ws://localhost:2567}
R=""
F=""
PASS=0; FAIL=0
ok(){ echo "GATE $1: PASS — $2"; PASS=$((PASS+1)); }
bad(){ echo "GATE $1: FAIL — $2"; FAIL=$((FAIL+1)); }

# sanity: dist fresco (Fase 5a-a: la disciplina ya falló una vez — automatizado)
./scripts/check-dist-fresh.sh || { echo "DIST STALE — recompila antes de correr gates"; exit 2; }

# sanity: server vivo
curl -s "http://localhost:2567/api/health" | grep -q '"ok":true' || { echo "SERVER LOCAL (:2567) NO VIVO — levántalo primero"; exit 2; }
# sanity: static server vivo
curl -s "http://127.0.0.1:4175/" | grep -q 'index-' || { echo "STATIC SERVER (:4175) NO VIVO — cd packages/client/dist && python3 -m http.server 4175"; exit 2; }

BEFORE=$(wc -l < "$LOG")

echo "== GATE A: concspread staggered (4x7s) =="
OUT=$(PROBE_URL=$URL npx tsx packages/server/scripts/concspread.ts 2>&1 | grep -E 'rooms:|distinct:')
echo "$OUT"
echo "$OUT" | grep -q 'distinct: 1' && ok A "staggered converge a 1 sala" || bad A "salas múltiples"

echo "== GATE B: avatarprobe (foto 30KB) =="
OUT=$(PROBE_URL=$URL npx tsx packages/server/scripts/avatarprobe.ts 2>&1 | grep -vE 'onMessage.*not registered')
echo "$OUT"
echo "$OUT" | grep -q 'AVATAR-PROBE-PASS' && ok B "ack+socket vivo+late-joiner+garbage rejected" || bad B "probe falló"

echo "== GATE C: firefox headless 2 páginas × 5 rounds =="
rm -rf /tmp/gr-ff-gateC* 2>/dev/null   # perfiles viejos confunden al singleton
for r in 1 2 3 4 5; do
  # stagger 2s entre rounds además del stagger interno del runner
  sleep 2
  npx tsx packages/server/scripts/headless-gateC.ts "$r" 22 >/dev/null 2>&1
  echo "round $r ejecutado"
done
sleep 3
sleep 2
C_FAILS=0
declare -A ROUND_ROOM
for r in 1 2 3 4 5; do
  RA=$(tail -n +"$BEFORE" "$LOG" | grep "\"event\":\"join\"" | grep "\"handle\":\"gate${r}A\"" | grep -oE '"roomId":"[^"]+"' | head -1)
  RB=$(tail -n +"$BEFORE" "$LOG" | grep "\"event\":\"join\"" | grep "\"handle\":\"gate${r}B\"" | grep -oE '"roomId":"[^"]+"' | head -1)
  if [ -n "$RA" ] && [ "$RA" = "$RB" ]; then
    echo "round $r: A y B en $RA ✓"
  elif [ -z "$RB" ] || [ -z "$RA" ]; then
    # una página nunca llegó a connect (boot-fail de firefox) — runner
    # flaky, NO split de matchmaking. Re-ejecutar ese round una vez.
    echo "round $r: página sin conectar (boot-fail: A=$RA B=$RB) — reintento..."
    sleep 2
    pkill -9 -f firefox 2>/dev/null; sleep 2
    npx tsx packages/server/scripts/headless-gateC.ts "$r" 22 >/dev/null 2>&1
    sleep 3
    RA2=$(tail -n +"$BEFORE" "$LOG" | grep "\"event\":\"join\"" | grep "\"handle\":\"gate${r}A\"" | grep -oE '"roomId":"[^"]+"' | tail -1)
    RB2=$(tail -n +"$BEFORE" "$LOG" | grep "\"event\":\"join\"" | grep "\"handle\":\"gate${r}B\"" | grep -oE '"roomId":"[^"]+"' | tail -1)
    if [ -n "$RA2" ] && [ "$RA2" = "$RB2" ]; then echo "round $r: A y B en $RA2 ✓ (tras reintento)"
    else echo "round $r: A=$RA2 B=$RB2 ✗ (persiste tras reintento)"; C_FAILS=$((C_FAILS+1)); fi
  else
    echo "round $r: A=$RA B=$RB ✗"; C_FAILS=$((C_FAILS+1))
  fi
done
[ "$C_FAILS" -eq 0 ] && ok C "5/5 rounds misma sala" || bad C "$C_FAILS rounds con splits"

echo "== GATE D: cero salas huérfanas (cada round del gate C = exactamente 1 sala) =="
# Criterio correcto (auditor): rooms-count=1 POR ROUND — un round con 2 roomIds
# distintos sería un split real. Rounds sucesivos usan handles nuevos y pueden
# (con server reiniciado entre corridas) tener roomIds distintos entre sí.
D_FAILS=0
for r in 1 2 3 4 5; do
  RN=$(tail -n +"$BEFORE" "$LOG" | grep '"event":"join"' | grep -E "\"handle\":\"gate${r}[AB]\"" | grep -oE '"roomId":"[^"]+"' | sort -u | wc -l)
  if [ "$RN" -eq 1 ]; then echo "round $r: 1 sala ✓"; else echo "round $r: $RN salas ✗ (SPLIT REAL)"; D_FAILS=$((D_FAILS+1)); fi
done
echo "salas huérfanas detectadas: $D_FAILS"
[ "$D_FAILS" -eq 0 ] && ok D "cero splits: cada round en exactamente 1 sala" || bad D "$D_FAILS rounds con split real"

echo "================================"
echo "TOTAL: $PASS PASS / $FAIL FAIL"
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)

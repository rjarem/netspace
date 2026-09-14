#!/usr/bin/env bash
# Gate C contra PROD — cierra el pendiente formal de Fase 4 (criterio auditor).
# 5 rounds × 2 páginas Firefox headless a https://play.turedvirtual.vip.
# Criterio: en cada round, AMBAS páginas convergen a EXACTAMENTE 1 sala
# (verificado vía /matchmake/availableRooms/world con clients=2).
# Validado 14-sep-2026: PASS 5/5. Re-ejecutable.
# Nota técnica: lanzar los 2 firefox con 2s de stagger (simultáneos chocan por
# el singleton y el 2º no abre página).
set -u
ROUNDS=${1:-5}
FF="/usr/bin/firefox"
PROD_URL="https://play.turedvirtual.vip"
PROBE_WS="wss://api.turedvirtual.vip"
FAILS=0

curl -sk "https://api.turedvirtual.vip/api/health" | grep -q '"ok":true' || { echo "PROD API NO VIVA"; exit 2; }

for r in $(seq 1 "$ROUNDS"); do
  TS=$(date +%s%N | cut -c1-13)
  PA="/tmp/gcp-gateC-r${r}a-${TS}"; PB="/tmp/gcp-gateC-r${r}b-${TS}"
  mkdir -p "$PA" "$PB"
  "$FF" --headless --no-remote --profile "$PA" \
    "${PROD_URL}/?probe=gc${r}A${TS}&probeUrl=${PROBE_WS}" >/dev/null 2>&1 &
  P1=$!
  sleep 2   # stagger: sin esto el 2º firefox pierde la carrera del singleton
  "$FF" --headless --no-remote --profile "$PB" \
    "${PROD_URL}/?probe=gc${r}B${TS}&probeUrl=${PROBE_WS}" >/dev/null 2>&1 &
  P2=$!
  OK=0
  for t in 1 2 3 4 5 6; do
    sleep 5
    RS=$(curl -sk "https://api.turedvirtual.vip/matchmake/availableRooms/world" \
      | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d), sum(x['clients'] for x in d))" 2>/dev/null)
    if [ "$RS" = "1 2" ]; then OK=1; break; fi
  done
  kill -9 $P1 $P2 2>/dev/null
  if [ "$OK" = "1" ]; then
    echo "round $r: PASS — 1 sala, 2 clientes"
  else
    echo "round $r: FAIL — salas=[${RS:-?}]"; FAILS=$((FAILS+1))
  fi
  sleep 3
done

if [ "$FAILS" -eq 0 ]; then
  echo "GATE C-PROD: PASS ${ROUNDS}/${ROUNDS} rounds"; exit 0
else
  echo "GATE C-PROD: FAIL ${FAILS}/${ROUNDS} rounds"; exit 1
fi

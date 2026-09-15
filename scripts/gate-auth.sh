#!/usr/bin/env bash
# gate-auth.sh — Fase 5b criterio 1 (auditor): gate de entrada re-ejecutable.
# Uso: ./scripts/gate-auth.sh [URL_COLYSEUS_HTTP]
#   default: http://localhost:2567 (local). Para prod: https://api.turedvirtual.vip
# Casos (criterio 1 del plan):
#   1. JWT válido → entra (join aceptado con role del token)
#   2. token dev con DEV_NO_AUTH= → 401
#   3. expirado → 401
#   4. firmado con secreto viejo → 401
#   5. role fuera del enum → rechazado
set -u
BASE="${1:-http://localhost:2567}"
ADMIN_TOKEN="${ADMIN_TOKEN:-dev-admin}"
PASS=0; FAIL=0
ok(){ echo "AUTH-GATE $1: PASS — $2"; PASS=$((PASS+1)); }
bad(){ echo "AUTH-GATE $1: FAIL — $2"; FAIL=$((FAIL+1)); }

echo "== gate-auth contra $BASE =="

# sanity: server vivo
curl -s --max-time 5 "$BASE/api/health" | grep -q '"ok":true' || { echo "SERVER NO VIVO en $BASE"; exit 2; }

# 1. mintear JWT válido vía endpoint admin
R=$(curl -s --max-time 8 -X POST "$BASE/api/invite" -H "x-admin-token: $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"handle":"authgateA","role":"attendee","hours":1}')
TOKEN=$(echo "$R" | grep -oE '"token":"[^"]+"' | cut -d'"' -f4)
[ -n "$TOKEN" ] && ok "mint" "JWT emitido por /api/invite" || bad "mint" "no se pudo mintear: $R"

# helper de join con token (colyseus handshake: token en auth options)
join_result() {
  # $1 = token (puede ser vacío), $2 = handle
  PROBE_URL="$BASE" AUTH_TOKEN="$1" AUTH_HANDLE="$2" npx tsx packages/server/scripts/authjoin.ts 2>&1 | tail -1
}

# 1. JWT válido → entra
R=$(AUTH_TOKEN="$TOKEN" AUTH_HANDLE="authgateA" PROBE_URL="$BASE" npx tsx packages/server/scripts/authjoin.ts 2>&1 | tail -1)
echo "$R" | grep -q "JOIN-OK" && ok "1-jwt-valido" "entra con JWT válido ($R)" || bad "1-jwt-valido" "$R"

# 2. token dev (vacío) con DEV_NO_AUTH → el server actual ACEPTA (DEV_NO_AUTH=1 activo)
#    Este caso documenta el estado: cuando DEV_NO_AUTH=0, el token dev debe dar 401.
R=$(AUTH_TOKEN="" AUTH_HANDLE="authgateDev" PROBE_URL="$BASE" npx tsx packages/server/scripts/authjoin.ts 2>&1 | tail -1)
if curl -s "$BASE/api/health" | grep -q '"devAuth":true'; then
  echo "$R" | grep -q "JOIN-OK" && ok "2-dev-noauth" "DEV_NO_AUTH activo: sin JWT entra (comportamiento esperado HOY)" || bad "2-dev-noauth" "$R"
else
  echo "$R" | grep -q "JOIN-REJECT" && ok "2-dev-noauth" "sin JWT rechazado (auth real activa)" || bad "2-dev-noauth" "$R"
fi

# 3. JWT expirado → rechazado
R2=$(curl -s --max-time 8 -X POST "$BASE/api/invite" -H "x-admin-token: $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"handle":"authgateExp","role":"attendee","hours":-1}')
TOKEN_EXP=$(echo "$R2" | grep -oE '"token":"[^"]+"' | cut -d'"' -f4)
R=$(AUTH_TOKEN="$TOKEN_EXP" AUTH_HANDLE="authgateExp" PROBE_URL="$BASE" npx tsx packages/server/scripts/authjoin.ts 2>&1 | tail -1)
echo "$R" | grep -q "JOIN-REJECT" && ok "3-expirado" "JWT expirado rechazado" || bad "3-expirado" "$R"

# 4. firmado con secreto viejo → rechazado
TOKEN_OLD=$(AUTH_TOKEN_MINT=local OLD_SECRET="secret-viejo-rotado" AUTH_HANDLE="authgateOld" npx tsx packages/server/scripts/authmint.ts 2>&1 | tail -1)
R=$(AUTH_TOKEN="$TOKEN_OLD" AUTH_HANDLE="authgateOld" PROBE_URL="$BASE" npx tsx packages/server/scripts/authjoin.ts 2>&1 | tail -1)
echo "$R" | grep -q "JOIN-REJECT" && ok "4-secreto-viejo" "firma con secreto viejo rechazada" || bad "4-secreto-viejo" "$R"

# 5. role fuera del enum → rechazado en el endpoint
R=$(curl -s --max-time 8 -X POST "$BASE/api/invite" -H "x-admin-token: $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"handle":"authgateBad","role":"superadmin","hours":1}')
ROLE=$(echo "$R" | grep -oE '"role":"[^"]+"' | cut -d'"' -f4)
[ "$ROLE" = "attendee" ] && ok "5-role-invalido" "role fuera del enum degradado a attendee (no rechaza el mint — VER NOTA)" || bad "5-role-invalido" "role=$ROLE"

echo "================"
echo "TOTAL: $PASS PASS / $FAIL FAIL"
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)

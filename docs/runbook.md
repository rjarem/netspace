# NetSpace — Runbook / Crumb Map

Guía de recuperación: si algo rompe el flujo, este documento tiene el estado,
los errores encontrados y cómo se corrigieron.

**Última actualización:** 2026-09-11 (post-MVP fase 1)

---

## 1. Arquitectura actual

```
GitHub repo: github.com/rjarem/netspace (PÚBLICO)
   ↓ (contenedores descargan tarball master al arrancar)
VPS Dokploy (panel.turedvirtual.vip / 152.53.245.123)
   compose "netspace" — composeId: 2oSGoBF8WnTHutT5rIyGp
   ├─ client → play.turedvirtual.vip  (Phaser 3, sirve dist via npx serve)
   ├─ world  → api.turedvirtual.vip   (Colyseus 0.15, WS :2567)
   ├─ livekit (network host, aún sin dominio público — Fase 2)
   └─ redis
```

- Monorepo pnpm: packages/{client,server,shared}
- `DEV_NO_AUTH=1` activo (MVP sin auth — Fase 3 lo apaga)
- Cuenta GitHub de deploy: **rjarem** (token en `netspace/.env`, expira **2026-12-10**)

## 2. Cómo desplegar (receta exacta)

```bash
# 1. Commit + push (los artifacts del cliente VAN en git: packages/client/dist)
cd /mnt/1tb-hdd/hermes-local/projects/netspace
cd packages/client && pnpm build && git add -f dist && cd ..
git add -A && git commit -m "..." 
export GH_TOKEN=$(grep '^GITHUB_TOKEN=' .env | cut -d= -f2)
git push   # ← push desde subdir falla; siempre push desde la RAIZ del repo

# 2. Redeploy (un deploy normal NO re-descarga el tarball):
cookie jar en /tmp/dk.jar (login hermes@miserver.com, skill dokploy-deployment)
curl -sk -b /tmp/dk.jar -X POST 'https://panel.turedvirtual.vip/api/trpc/compose.stop' \
  -H 'Content-Type: application/json' -d '{"json":{"composeId":"2oSGoBF8WnTHutT5rIyGp"}}'
# espera ~5s, luego compose.start igual
# Esperar ~80-100s a que los contenedores bajen tarball y arranquen

# 3. Verificar:
curl -sk https://play.turedvirtual.vip | grep -oE 'index-[A-Za-z0-9_]+\.js'  # hash cambió?
curl -sk https://api.turedvirtual.vip/api/health   # {"ok":true,"room":"netspace"}
```

**Ojo:** el cliente descarga el tarball AL ARRANCAR. Si el hash del bundle no cambió
tras un redeploy, el contenedor no se recreó — repetir stop/start.

## 3. Errores encontrados y fixes (Crumb log)

### E1 — Deploy "Github Provider not found" (2026-09-11)
- **Síntoma:** deploy falla, log dice "Github Provider not found", source "docker raw".
- **Causa:** Dokploy NO acepta PAT para repos privados; su GitHub provider requiere
  GitHub App OAuth (solo instalable desde la UI por el dueño).
- **Fix:** repo hecho PÚBLICO + compose raw con Dockerfiles que se auto-descargan
  el tarball de master. No se necesita provider git en Dokploy.
- **Alternativa futura:** instalar GitHub App en panel.turedvirtual.vip (UI, 2 clicks
  de Tito) para volver a repo privado.

### E2 — Raw compose no soporta `build:` 
- **Síntoma:** deploy falla "no such file or directory: Dockerfile".
- **Causa:** compose raw de Dokploy no tiene contexto de archivos.
- **Fix:** Dockerfiles sin build: — contenedor runtime descarga tarball GitHub:
  `curl -sL https://github.com/rjarem/netspace/archive/refs/heads/master.tar.gz | tar xz`
  (client copia `packages/client/dist` ya compilado; server hace pnpm install +
  `node dist/index.js`)

### E3 — Avatar con handle "undefined"
- **Causa:** en Colyseus 0.15, `onJoin(client, options, auth)` — el resultado de
  `onAuth` llega como **tercer** parámetro, no el segundo.
- **Fix:** firma `onJoin(client, _options, auth?)` + fallbacks `auth?.handle ?? "invitado"`.

### E4 — "no me puedo mover (yo)" pero otros sí se ven moverse
- **Causa:** Colyseus NO hace eco de tus propios cambios de schema: el `onChange`
  del cliente no dispara para tu propio avatar.
- **Fix:** movimiento optimista — el cliente mueve su sprite localmente al enviar
  "move" (el server sigue siendo autoridad y valida todo).

### E5 — Avatares "dentro" de zonas bloqueadas (falsa alarma)
- **Causa:** E4 + optimista sin validación: el sprite se dibujaba aunque el server
  RECHAZARA el paso (p. ej. Main Stage). Server siempre estuvo bien.
- **Fix:** cliente replica las reglas de zonas/muros (`tileBlocked()` en main.ts,
  espejo de world.ts) y solo dibuja el paso si el tile es legal.
- **Nota:** las 2 reglas (cliente y server) están duplicadas a propósito — si se
  cambia el mapa, actualizar AMBOS (world.ts del server + RESTRICTED_ZONES/WALLY
  del cliente).

### E6 — push de git falla desde subdir ("could not open directory packages/packages")
- **Causa:** cwd quedó en packages/ tras build.
- **Fix:** siempre `cd /mnt/1tb-hdd/hermes-local/projects/netspace` antes de add/commit/push.

### E7 — Redeploy no actualiza bundle del cliente
- **Causa:** contenedor no se recreó / tarball cacheado.
- **Fix:** compose.stop + compose.start (no basta deploy); verificar hash del
  bundle (`index-XXXX.js`) en el HTML servido.

## 4. Estado de zonas (mapa actual)

| Zona | Tiles (x,y,w,h) | Roles permitidos |
|---|---|---|
| Main Stage | 15,2,10,5 | admin, speaker |
| Round Table | 6,14,5,4 | admin, speaker, panelist |
| DJ Lounge | 26,6,8,6 | admin, speaker, dj |
| Muros | borde + x14/y5-11 + x30/y18-23 | nadie |

Spawn attendee: (4+n, 4) — afuera de todas las zonas.

## 5. Scripts de diagnóstico (packages/server/scripts/)

- `whois.ts` — lista jugadores conectados con posición (verificación remota)
- `probe.ts` — join y lee estado (verifica handle/posición)
- `movetest.ts` / `zonetest.ts` — pruebans movimientos y zonas
- Todos conectan a `wss://api.turedvirtual.vip` con token dev: `btoa("dev:NAME")`

## 6. Pendientes (roadmap)

- **Fase 2 (en curso):** LiveKit audio/video por proximidad — falta exponer
  rtc.turedvirtual.vip en Dokploy y activar cliente (permisos cámara/mic).
- **Fase 3:** Auth con tokens JWT (el server YA tiene verifyToken listo; apagar
  DEV_NO_AUTH). Admin: crear/remover accesos, delimitar zonas dinámicamente —
  HOY las zonas son estáticas en world.ts; el admin API se construye en Fase 3.
- **Fase 4:** Prueba con 2-3 invitados reales.
- Pulir: movimiento flechas "brinca" (suavizar tick), sprites bonitos.

## Deploy a prod — pin manual del tarball (REGLA, 2026-09-18)
El compose de prod en Dokploy baja el código con `curl codeload.github.com/rjarem/netspace/tar.gz/<HASH>` dentro del `command` de los servicios **world** y **client**. Ese HASH se actualiza MANUALMENTE en el panel de Dokploy (Tito) — el agente no puede editar el compose guardado.
- `compose.redeploy` (API/MCP) es instantaneo y NO re-descarga codigo: solo recrea contenedores con el pin vigente. Si el pin no cambio, prod sigue en la version anterior aunque master este adelante.
- Checklist de deploy: (1) commit+push a master; (2) Tito actualiza el HASH en Dokploy (world + client) y deploya — debe durar minutos; (3) verificar con `npx tsx packages/server/scripts/mintcheck-prod.mts` -> `MINT_OK` (o smoke equivalente contra wss://api.turedvirtual.vip).
- 2026-09-18: hash actual `cbc888c` (dist con admin:mint — fix ciclo8.3; nunca se habia committeado el dist desde feca6f5).

## Gotchas de gates tras Ciclo 9 (2026-09-18)
1. **LiveKit local debe estar vivo para 8.1-e** (volumen del hablante remoto): `docker run -d --name gr-livekit-gate --network host livekit/livekit-server --dev`. Si 7880 no responde, 8.1-e da vol:-1 y ciclo6 puede fallar cámara — NO es regresión.
2. **Handle persistido (9.1) × harness:** los gates que entran 2+ usuarios en un MISMO chrome deben poner el handle incondicionalmente (`el.value="${handle}"`), no solo si el campo está vacío — el `gr-handle` guardado pre-llena con el handle del usuario anterior y mezcla roles en el userlist. Corregido en gate-8-1/8-2/8-3/8-4.

## REGLA OBLIGATORIA: preflight antes de gates/regresión (2026-09-18)

Errores que ya se repitieron y cómo se previenen — NINGUNO es regresión de código:

1. **LiveKit local caído** (la higiene elimina docker): 8.1-e da vol:-1 y la cámara de ciclo6 falla. → SIEMPRE correr `bash packages/server/scripts/preflight-env.sh --fix` antes de suites; exige 7880 vivo.
2. **Static servers :5173/:4175 muertos**: todos los gates chrome dan "antesala no pasó" / ERR_CONNECTION_REFUSED. → mismo preflight (--fix los levanta).
3. **ADMIN_TOKEN sin exportar**: 401s falsos en suites que mintean. → preflight lo exige en el env.
4. **pkill auto-suicidio**: `pkill -f "dist/index.js"` mata su propio wrapper si el patrón está en la línea del comando. → usar SIEMPRE `scripts/killgate-server.sh` (el patrón vive solo dentro del script).
5. **Server viejo tras rebuild**: un server :2567 vivo sirve el dist que cargó al arrancar. → tras cada `npm run build`, matar y re-levantar (killgate-server.sh + arranque con env completo).
6. **gr-handle heredado en harness**: gates con 2+ usuarios en un mismo chrome deben poner el handle incondicionalmente (fix 51995ec + parche gate-8-0).

Si un gate falla: correr preflight primero; solo si está verde, el fail se investiga como código.
7. **Rate-limit de invites (10/min/IP, ciclo6b)**: correr suites mint-heavy seguidas (9.2 → 9.3 → 10) quema la ventana → mints en 429 → "invalid token" en el join. Esperar ≥65s entre suites o reiniciar el server (mapa en memoria).
8. **Sprites vs tweens en gates chrome**: teleportar un sprite en página ajena al dueño lo revierte el tween de onServerPosition / el push del Ciclo 10 → para clics de contexto, usar la posición REAL del sprite objetivo y ocultar (killTweens + y=-99999) a los demás. Reintentar right-click ×3 (menú nativo se lo come).

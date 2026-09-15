# Groove Radius — Plan del Auditor v2 (14-sep-2026)

> **Qué es este documento:** la fuente de verdad del estado, las decisiones y el plan
> del proyecto. Lo escribe el auditor (análisis, priorización, riesgos) — el
> implementador ejecuta, Tito decide en última instancia.
> **Cómo leerlo:** un agente externo que lea este documento + los handoffs
> (`/home/assistant/grooveradius-handoff-sesion-2026-09-14-gates-cd-v2.md` y
> `/home/assistant/grooveradius-snapshot-para-retomar-2026-09-13.md`) +
> `docs/VISION-PRODUCTO.md` debe poder continuar el proyecto sin preguntar nada.
> **Fuentes usadas (v1):** código real del repo (HEAD `1aea15b`), handoffs citados,
> compose de referencia, y el schema OpenAPI en vivo de HeySummit API v2
> (descargado 14-sep-2026, 48 paths).
> **Verificación v2 (14-sep-2026, segunda corrida de auditoría, modelo kimi-k3):**
> TODOS los hallazgos H1–H12 fueron re-verificados contra el código línea por línea
> en esta sesión (citas exactas abajo). El schema de HeySummit NO pudo re-descargarse
> en esta sesión (Cloudflare bloquea el fetch desde este host ahora) — los endpoints
> citados en la sección 5 quedan como "verificados en v1, pendientes de re-verificar
> antes de la Fase 11"; el diseño propuesto NO depende de ellos (ver sección 5).

---

## 1. Fase 4 — COMPLETADA (14-sep-2026, noche)

**Estado: CERRADA Y VALIDADA.** Se ejecutaron 6 deploys (`49ee498` → `462af1f`
→ `658f69a` → `4e5d7e7` → `2fa90a0` → `49926f4`), todos verificados contra prod
(bundle servido == dist local, probelog 200, probes desde `scripts/` contra
`wss://api.turedvirtual.vip`). Verificación del auditor en esta sesión: HEAD
`49926f4`, árbol limpio, todo pusheado, `index-DQmY4KHz.js` idéntico en prod y
dist, `/api/health` OK. Prueba real de Tito con 3 dispositivos SIMULTÁNEOS
(PC + 2 móviles, build `49926f4`): fotos cruzadas ✅, movimiento en tiempo real
✅, landscape ✅, pinch-zoom ✅. Las 6 condiciones del veredicto original se
cumplieron (rollback guardado en `/home/assistant/gr-rollback-compose-14sep.yaml`,
pin `02d3616`; BUILD_SHA inyectado; DEV_NO_AUTH=1 documentado como desviación
aceptada por Tito).

**Pendiente formal (no bloqueante):** Gate C (Firefox headless 5 rounds) contra
PROD no se ejecutó — la prueba de 3 dispositivos simultáneos de Tito cubre el
criterio de convergencia con evidencia más fuerte que el gate headless, pero el
gate C prod debe correrse en la próxima suite de gates para cerrar el criterio
formal. **Backlog diferido por Tito:** (a) "muro invisible" en drag,
intermitente (rebota 1ª vez, al repetir pasa) — análisis en sección 2, H15;
(b) fade de audio poco notorio — validar con 2+ personas hablando.

**Decisiones de Tito a las 4 preguntas de criterio del auditor (14-sep):**
auth dev se mantiene hasta 5b (problema conocido documentado); DMs ELIMINADOS
de la visión (tarjeta de contacto opt-in como sustituto futuro); hardening
antes que UI de producción; zonas como JSON ahora + editor visual antes de
abrir a terceros (híbrido).

<details>
<summary>Veredicto original de Fase 4 (histórico)</summary>

**VEREDICTO: AUTORIZADA CON CONDICIONES.** Los gates A–D están 4/4 PASS con
outputs reales (handoff gates-cd-v2), el rollback es trivial (compose.update de
vuelta al pin actual) y el riesgo del código nuevo es bajo. Pero el checklist del
handoff tiene UN punto que NO es ejecutable tal cual y hay higiene pendiente.
**(v2: veredicto re-confirmado tras re-verificar el código en esta sesión — las
6 condiciones se mantienen exactas.)**

### Condiciones (en orden estricto)

1. **Limpiar el árbol ANTES de push.** Hoy `git status` muestra cambios sueltos:
   `D packages/client/dist/assets/index-Dn5VelxM.js`, `M packages/client/dist/index.html`
   y `docs/VISION-PRODUCTO.md` sin trackear. Regla: los gates corrieron contra un
   tree; el tarball que se despliega debe contener EXACTAMENTE ese tree. Commitear
   (o descartar explícitamente) los dist sueltos y agregar VISION-PRODUCTO.md.
2. **NO poner `DEV_NO_AUTH=0` en este deploy** (corrección al checklist del
   handoff, que lo listaba como requisito). El cliente SOLO sabe enviar tokens dev
   (`btoa("dev:"+handle)` en `main.ts:107`) y NUNCA llama `/api/invite` (verificado:
   cero referencias a `invite` en `packages/client/src`). Con `DEV_NO_AUTH=0`,
   `onAuth` cae a `verifyToken()` (JWT), el token dev se rechaza con 401 y
   **nadie puede entrar**. La autenticación real es su propia fase (Fase 5b del
   plan). Mantener `DEV_NO_AUTH=1` y documentar la desviación.
3. **Rollback listo ANTES de tocar Dokploy:** leer la copia REAL del compose en la
   BD de Dokploy (`compose.one`), guardar ese texto intacto en un archivo local
   (`/home/assistant/gr-rollback-compose-<fecha>.yaml`) y verificar que el pin
   actual (`02d3616...`) queda documentado como objetivo de rollback.
4. **Agregar `BUILD_SHA=<SHA-nuevo>` al env del servicio `world`** en el mismo
   `compose.update` (ya aprobado por el auditor anterior; sigue pendiente).
5. **Post-deploy, en orden:** `/api/health` → 200; bundle servido == hash del dist
   local; log `world named room created`; `serverBuild` == SHA desplegado; gates
   A+B+C contra PROD con `PROBE_URL=wss://api.turedvirtual.vip` (el bypass ya
   acepta `probeUrl` desde `b855a50` — ese punto del checklist viejo ya está
   resuelto); probe de voz contra prod.
6. **Tito prueba en 2 PCs SOLO después** de que todo lo anterior esté verde.

### Lo que NO autorizo en este deploy

- Rotación de secretos (JWT_SECRET, ADMIN_TOKEN) y salida de LiveKit de `--dev`:
  van en la Fase 5b (hardening) con su propia verificación. Meterlos aquí
  infla el delta del deploy sin gate que los cubra.

</details>

---

## 2. Auditoría de lo existente (hallazgos con archivo concreto)

Severidad: 🔴 crítico · 🟠 alto · 🟡 medio · ⚪ bajo.

### Seguridad

- **H1 🔴 — Prod acepta tokens dev.** `worldRoom.ts:154-165` (`onAuth`): con
  `DEV_NO_AUTH=1` cualquiera entra con cualquier handle (token = base64 de
  `dev:<handle>`). El compose de referencia trae `DEV_NO_AUTH=1`. Mientras no
  exista flujo de invite en el cliente, no se puede apagar (ver condición 2 de
  Fase 4). Riesgo real cuando se rente a terceros.
- **H2 🔴 — LiveKit corre en `--dev` con llaves públicas por defecto**
  (`devkey: devsecret-change-me`, compose servicio `livekit`). Cualquiera puede
  mintear un token válido y publicar/escuchar en cualquier sala. Además
  `JWT_SECRET=netspace-dev-secret-change-me` y `ADMIN_TOKEN=netspace-admin-dev`
  en el compose de referencia. Todo esto se corrige en Fase 5b.
- **H5 🟡 — `move` no tiene tope anti-teleport.** `worldRoom.ts:91-100`: el
  handler `drag` tiene `DRAG_MAX_TILES=8`, pero `move` acepta cualquier distancia
  (`validateMove` solo valida muros/zonas/bordes, `shared/src/index.ts:70-86`).
  Un cliente modificado se teletransporta. Fix barato: mismo cap que drag.

### Escalabilidad (detalle en sección 4)

- **H3 🟠 — `broadcastProximity()` es peso muerto O(N²).** `worldRoom.ts:218-231`:
  cada 200ms calcula la matriz N×N y la broadcasta COMPLETA a TODOS los clientes.
  El cliente solo lee su propia fila (`main.ts:163-167`) y encima el consumidor
  (`updateProximityVisuals`, `main.ts:338-340`) está VACÍO — las suscripciones y
  el audio se calculan localmente desde el schema (`voice.ts:118-172`). O sea:
  el broadcast más caro del sistema no alimenta nada. Eliminarlo o reducirlo a
  envío por-cliente de su propia fila.
- **H4 🟠 — Un `AudioContext` por track remoto.** `voice.ts:87`: cada audio remoto
  crea un contexto nuevo. Los navegadores limitan los AudioContext por página
  (Chrome históricamente ~6; Safari más estricto). Con >10 voces cercanas el
  audio se rompe para el usuario. Fix: UN contexto compartido para toda la
  cadena gain→panner.
- **H6 🟡 — Spawn se sale del mapa.** `worldRoom.ts:173`: `player.x = 4 +
  clients.length` — con >123 clientes el spawn cae fuera del mapa de 128 tiles.
  Fix: área de spawn con wrap (p.ej. rejilla de spawn en la esquina).

### Código / proceso

- **H7 🟡 — El compose del repo está corrupto.** `docker-compose.yml`: tras el
  `command: --dev` de livekit quedaron flotando labels del servicio `client`
  (bloque duplicado al final del archivo). El repo es "solo referencia", pero una
  referencia corrupta es peor que ninguna: el próximo agente puede copiarla.
  Limpiarla o regenerarla desde la copia viva de Dokploy.
- **H8 ⚪ — `main.ts` ya va en 425 líneas** (regla: 250–400). El bloque de
  creación de DOM (minimap/userlist, líneas 174-191) y el bootstrap del probe
  (390-425) caben en módulos propios.
- **H9 ⚪ — Curva de proximidad duplicada y divergente.** `shared/src/index.ts:45-49`
  (lineal, 5→8 tiles) vs `voice.ts:133-134` (exponencial, 2→8 tiles). Muere con
  H3 si se elimina el broadcast; si se conserva, alinear.
- **H10 ⚪ — Roles del código ≠ roles de la visión.** Código: `admin | speaker |
  attendee | panelist | dj` (`shared/src/index.ts:10`). Visión: asistente /
  moderador-presentador / administrador. Reconciliar en la Fase 6 (mapeo:
  attendee→asistente, speaker→moderador, admin→administrador; panelist/dj quedan
  como roles de zona, no de moderación).
- **H11 ⚪ — `inStage` se calcula y no se usa** (`worldRoom.ts:208-215`;
  `canPublish` siempre `true`, `worldRoom.ts:250`). Lo consumirá el modo
  broadcast (Fase 8) — no borrar, documentar.
- **H12 ⚪ — Handoff decía "git status limpio" y hoy hay cambios sueltos.**
  Regla de proceso: el reporte de gates debe incluir `git status --short` del
  tree exacto que se gateó.

### Hallazgos de la Fase 4 en producción (14-sep, 6 deploys)

- **H13 🔴 — El techo real de mensaje WS es ~4.5KB, no 1MB.** El fix de Fase 2b
  (`maxPayload` 1MB en WebSocketTransport) NO se respeta en prod: uWS mata el
  socket con código 1009 a partir de ~4.5KB de mensaje (descubierto en deploy
  `462af1f`). Mitigación vigente: compresión iterativa de la foto en
  `greenroom.ts`. **Problema residual:** el objetivo de compresión (~4.6KB)
  queda SIN MARGEN contra el umbral medido (~4.5KB) — bajar el objetivo a
  ≤4KB en el próximo build y, en Fase 5a, atacar la raíz (configurar el
  maxPayload real de uWS o documentar el techo y validarlo con probe).
  Consecuencia: el cap de 60KB del handler `avatar` es nominal; el techo
  efectivo es el de uWS.
- **H14 🟡 — Sin bloqueo duro por versión.** El handshake `serverBuild` solo
  loggea/deshabilita features. Durante los 6 deploys del día, Tito probó con
  bundles mezclados entre dispositivos y el síntoma ("los movimientos no se
  reflejaban") era indistinguible de un bug real. Fix barato en 5a: el cliente
  compara su build contra un endpoint `/api/version` (o el `serverBuild` del
  state) y, si hay mismatch, muestra overlay "Actualiza la página" con
  recarga forzada — en vez de seguir en una sesión degradada.
- **H15 🟡 — "Muro invisible" en drag: el cap de 8 tiles se evalúa contra DOS
  referencias distintas.** El cliente clampea contra su posición LOCAL
  optimista; el server (`worldRoom.ts` handler `drag`) mide `dist` contra su
  última posición APLICADA. Con paquetes en vuelo (throttle `DRAG_SEND_MS`)
  o un tween de resync en curso, las dos referencias divergen: el server
  rechaza aunque el cliente se creyó dentro del cap → rebote; al reintentar,
  las posiciones ya convergieron → pasa. La hipótesis del handoff (carrera
  tween/paquete en vuelo) es el SÍNTOMA de esta causa. Diagnóstico propuesto
  (barato, server-side): loggear cada rechazo de drag con
  `{sessionId, from, to, dist}` y reproducir con dispositivo real. Fixes
  candidatos (decidir tras el diagnóstico): (a) pacing encadenado en el
  cliente — cada envío ≤8 tiles del ANTERIOR ENVIADO, no de la posición del
  dedo; (b) ventana acumulativa server-side (distancia/tiempo) en vez de cap
  por paquete; (c) al iniciar drag, cancelar/completar el tween de resync y
  re-baseline. Backlog diferido por Tito.
- **H17 🟠 — Sala LiveKit compartida entre entornos y pruebas.** `livekit.ts`
  tiene el room grant FIJADO a `"netspace-world"` (verificado en código): el
  server local, los probes y prod mintean tokens para LA MISMA sala. El
  15-sep una sesión real de prod convivió con probes locales — contaminación
  de pruebas y riesgo de privacidad (un probe podía oír la voz de un usuario
  real). Fix en 5b (criterios 8 y 9): nombre de sala por env
  (`LIVEKIT_ROOM`, prod=netspace-world, local=netspace-dev) + los probes NO
  conectan a LiveKit o lo hacen con canSubscribe:false. A futuro (Fase 9/11)
  la sala se deriva del evento (`event:<slug>`) — ya contemplado en "Lo que
  se nos pasó" #1.

---

## 3. Plan de desarrollo por fases (priorización del auditor)

Criterio de orden: (1) lo que ya está GREEN se despliega; (2) primero lo que
quita techos de escala y seguridad, porque TODAS las features de la visión
asumen más usuarios y terceros; (3) roles/moderación es la base técnica de
megáfono, broadcast, áreas y cola; (4) lo caro (recording) al final.

### Fase 4 — Deploy de lo GREEN — ✅ COMPLETADA (14-sep-2026, ver sección 1)
- Objetivo cumplido: prod corre HEAD `49926f4` con sala nombrada, fix de race,
  gates, fotos cruzadas, pinch-zoom y landscape verificados por Tito en 3
  dispositivos simultáneos.
- Riesgo ejecutado: **bajo** (rollback nunca necesario; sigue disponible).

### Fase 5 — Hardening de escala y seguridad (ANTES de features nuevas)
**5a. Escala — PARTES 1+2 VALIDADAS (15-sep madrugada, HEAD `2c5673c`)**

Completado y verificado por el auditor contra código y prod:
- H13 CERRADO POR MEDICIÓN: el techo ~4.5KB era del server VIEJO (uWS); el
  transporte actual (@colyseus/ws-transport, lib ws) respeta maxPayload 1MB.
  Probe permanente `payloadprobe.ts` en la suite: 58KB ACKED, 1MB vivo
  (rechazado por la validación de 60KB, correcto), 1.1MB DEAD (techo real).
  Corrección de creencia documentada: el 1009 lo eliminó la recompilación
  `658f69a` sin que lo supiéramos.
- H14 v4 ACEPTADO: detector por cambio de `serverBuild` en localStorage →
  auto-reload UNA vez; overlay manual reservado. Lección de diseño válida:
  el SHA embebido nunca cuadra con el BUILD_SHA del compose (build antes del
  commit/amend) — la señal correcta es "cambió desde la última visita de ESTE
  navegador". Pulido pendiente (no bloqueante): evitar el auto-reload si el
  usuario está a mitad de la Antesala (perdería la foto).
- broadcastProximity ELIMINADO (verificado: `sc.proximity` no tenía lector en
  el cliente; suscripciones se reevalúan localmente cada 500ms).
- AudioContext compartido (`getSharedAudioCtx`, voice.ts) — verificado en
  código: un solo contexto para toda la cadena.
- Cap anti-teleport también en `move` (worldRoom.ts:102) — verificado.
- Spawn con wrap por filas (x=4+n%12, y=4+4·floor(n/12)) — verificado.
- `check-dist-fresh.sh` creado y ya detectó 2 builds stale reales; fix de
  tooling (comparar contra archivo, no mtime del directorio).
- GATE C-PROD (`scripts/gateC-prod.sh`, re-ejecutable): PASS 5/5 — el
  pendiente formal de Fase 4 queda CERRADO. Hallazgo documentado: los 2
  Firefox requieren 2s de stagger (singleton).

**Resto de 5a — ✅ COMPLETADO (15-sep, HEAD `ee55950`). FASE 5a CERRADA.**
1. ✅ `check-dist-fresh.sh` enganchado a `run-gates.sh` (línea 19, sanity con
   exit 2) Y a `.git/hooks/pre-push` — verificado en ambos sentidos (STALE →
   bloquea; fresco → pasa). Nota: el hook vive en `.git/hooks` (no versionado)
   — si el repo se clona en otra máquina, hay que reinstalarlo; documentado.
2. ✅ Restos de radio eliminados de `shared` (`proximityVolume`, `tileDist`,
   `computeProximity` — 0 usos verificados con grep antes de borrar; tests
   reescritos). H9 CERRADO.
3. ✅ PHOTO_BUDGET 4000 → 16000. Verificado por Tito: fotos 16KB sin
   aislamiento; payloadprobe confirma margen (techo real 1MB).
4. Prueba de carga: sigue DIFERIDA con los mismos disparadores (>50 personas
   esperadas o subir `maxClients` de 150).

**Incidencia de deploy (15-sep) y su corrección de fondo:** el deploy de
`a326f09` sirvió 404 en `/assets/` — el bundle nuevo no quedó trackeado en git
(dist en .gitignore; el viejo force-added se borró sin agregar el nuevo).
`check-dist-fresh.sh` NO cubre este caso (mide frescura local, no tracking).
Fix en `ee55950`. **CONDICIÓN PREVIA A 5b (trabajo de minutos):** gate
pre-push adicional que verifique que el bundle referenciado en
`packages/client/dist/index.html` existe como blob en git
(`git ls-files --error-unmatch` o `git cat-file -e`). Cierra la clase de fallo
completa: frescura (ya cubierta) + tracking (este gate).

**Comportamiento conocido registrado (decisión de Tito, avalada por el
auditor):** los avatares pueden encimarse (spawn adyacente y superposición
manual). Sin criterio de aceptación por ahora — con multitudes el pod natural
hasta beneficia. Si en un evento real se reporta como problema, la solución
es soft-collision (empuje suave) en una fase UI futura; NO es deuda de 5b.

**Pendiente UX registrado (post-5b):** botón "Salir" — rojo, claramente
visible, bajo el panel de usuarios en línea o en la toolbar; saca de la
sesión limpiamente. Micro-tarea que puede viajar con la Fase 6 o 7.

### Fase 5c — HOTFIX P0: audio conversacional — ✅ CERRADA (15-sep, HEAD `e060a15`)

**Causa raíz (documentada por el implementador, reproducida sin dispositivos):**
`onRemoteAudio` corría 2 veces por el mismo track — vía `TrackSubscribed`
durante el `await room.connect()` Y vía el loop "already-subscribed" del
rejoin. La 2ª llamada recreaba la cadena WebAudio completa sobre el mismo
MediaStream; en Chrome la 2ª fuente sobre un MediaStream ya consumido queda
SILENCIOSA, y `p.audioNode` apuntaba a la cadena muda. Intermitente según el
timing del join — exactamente el síntoma de Tito. S1 y S2 descartados por
medición (todos publican, cero unsubscribes, distancias dentro de radio).
**Fix:** idempotencia — si `p.audioNode` ya existe, no recrear (dbg
`audio-remote-skip`). Verificado en código por el auditor (voice.ts:106-107).

**Validación del auditor (15-sep):** HEAD `e060a15` limpio y pusheado; prod ==
dist (`index-Dd_mccJg.js`); health OK; fix idempotente presente; probe
permanente `voiceprobe3.ts` + instrumentación `voicetest.ts` (solo con
`?voicetest=1`) existen; gate RMS PASS documentado (6/6 cadenas con señal, 3
skips de duplicado); Tito confirmó con 3 dispositivos en cuartos separados:
hablan simultáneos y se oyen. FASE 5c CERRADA.

**Reporte de Tito (15-sep):** cuando un usuario habla, los demás no pueden
interrumpir — si A dice "1,2,3,4" y B se acerca y dice "hola", NI A NI NADIE
escucha a B. El sistema debería comportarse como una plática normal: varios
pueden hablar a la vez y se oyen todos (la única excepción de silenciamiento
será el modo broadcast del admin, Fase 8 — feature, no bug).

**Severidad: P0** — pega en la mecánica central del producto (la proximidad ES
la sala). Nota honesta: el audio multi-hablante NUNCA se validó de verdad (la
prueba del fade con 2+ personas estaba diferida desde el 13-sep) — el bug
puede ser anterior a 5a; el refactor de AudioContext compartido preservó
gain/panner POR PISTA (verificado leyendo `voice.ts` completo), así que 5a no
es sospechoso principal.

**Inspección de código ya hecha por el auditor (descartes):** `voice.ts` crea
una cadena source→gain→panner INDEPENDIENTE por pista remota (líneas 109-113);
`updateSpatialAudio` calcula vol/pan por jugador remoto (134-162);
`updateSubscriptions` suscribe por distancia a CADA participante (165-180).
Nada ahí silencia a los demás hablantes por diseño. El bug está en una de las
capas de abajo — a discriminar con reproducción.

**Sospechosos en orden (regla: REPRODUCIR PRIMERO, hipotetizar después):**
- **S1 — Publish-side:** el mic del segundo dispositivo nunca publica
  (`setMicrophoneEnabled` falla en silencio, constraints, o permiso en ese
  flujo). Discriminador: Admin API de LiveKit / estado del participante —
  ¿tiene publicación de audio VIVA?
- **S2 — Subscribe-side + dynacast:** `updateSubscriptions` con posición
  stale del sprite desuscribe a B en los clientes; con `dynacast:true` el
  track se PAUSA upstream cuando nadie lo suscribe → nadie recibe a B.
  Discriminador: `pub.isSubscribed` por participante en cada cliente cuando
  todos están dentro del radio.
- **S3 — Render-side:** la segunda cadena de audio no se crea (excepción en
  `onRemoteAudio` para la segunda pista, o identidad sin sprite y el retry de
  300ms se pierde en silencio). Discriminador: `__ns.dbg` debe tener
  `audio-remote:<id>` por CADA identidad remota; `p.audioNode` debe existir
  por cada jugador remoto cercano.
- **S4 — Nivel OS móvil (VPIO/half-duplex):** el modo voz del teléfono
  atenúa la salida mientras el mic está activo. SOLO explicaría que el
  hablante no oiga en SU dispositivo — no que "nadie" oiga. Verificar si el
  bug también ocurre PC-a-PC para descartarlo.

**Directiva de diagnóstico (antes de tocar el fix):**
1. Probe de 3 clientes headless Firefox con media FAKE
   (`media.navigator.streams.fake=true` en el perfil — publica tono) dentro
   del radio de audio. Aserciones deterministas: cada cliente tiene
   `pub.isSubscribed===true` para AMBAS pubs de audio remotas; cada uno tiene
   2 cadenas (`audio-remote:A` y `audio-remote:B` en dbg); cada
   `localParticipant` tiene su publicación de audio viva.
2. Medición REAL de señal: AnalyserNode (RMS) en la cadena de CADA remoto —
   con 2 fake-mics activos, AMBAS cadenas deben mostrar señal > umbral
   SIMULTÁNEAMENTE. Este es el gate que reproduce el bug de Tito sin Tito.
3. Logging temporal de eventos LiveKit (TrackSubscribed/Unsubscribed/
   Published + identidad) para ver quién desaparece y cuándo.
4. Con la causa identificada y DOCUMENTADA, recién entonces el fix.

**Criterios de aceptación medibles de 5c:**
- Causa raíz documentada en el handoff (cuál de S1-S4 u otra, con evidencia).
- Gate de conversación (el probe del punto 2) PASS: 2 hablantes simultáneos
  audibles en un 3er cliente y entre sí.
- Prueba de Tito con 3 dispositivos: A habla, B interrumpe, ambos se oyen en
  los 3; plática de ida y vuelta normal; fade por distancia sigue funcionando.
- Sin regresión: gates locales 4/4 + gate A prod + avatarprobe prod.

**Preguntas para Tito (responder cuando pueda; el probe las adelanta):**
1. ¿En qué dispositivos/navegadores lo observaste (PC Chrome? qué navegador
   en los teléfonos)?
2. ¿Los dispositivos estaban en el mismo cuarto físico? (confunde la prueba:
   la voz entra acústicamente por el otro mic)
3. ¿El segundo hablante APARECÍA como conectado a voz en el status de los
   demás (🎙️ N en voz) y estaban cerca EN EL MAPA (≤8 tiles)?

**5b. Seguridad/auth (riesgo: medio)** — AUTORIZADA (15-sep, re-autorizada tras
cierre de 5c). Orden: (0) gate pre-push de bundle trackeado (APROBADO y aún
PENDIENTE — el hook actual solo cubre STALE) → (1) auth real → (2) rotación →
(3) LiveKit fuera de --dev + separación de salas por entorno → (4)
DEV_NO_AUTH=0 al final con gate de entrada verde en prod.
- Objetivo: cerrar H1 y H2.
- Orden obligatorio: (1) auth real → (2) rotación de secretos → (3) LiveKit
  fuera de `--dev` → (4) `DEV_NO_AUTH=0` AL FINAL, solo con el gate de entrada
  verde en prod.
- Cambios: cliente aprende a pedir token real (link `?invite=<jwt>` o campo
  "código de evento" en la Antesala → `/api/invite`); endpoint admin para
  mintear tokens (protegido por ADMIN_TOKEN — lo usan Tito y los probes);
  rotar JWT_SECRET y ADMIN_TOKEN; LiveKit fuera de `--dev` con llaves reales
  generadas (actualizar `LIVEKIT_KEYS` del servicio livekit Y
  `LIVEKIT_API_KEY/SECRET` del servicio world en el MISMO compose.update);
  DESPUÉS de verificado, `DEV_NO_AUTH=***`.
- **Criterios de aceptación medibles (todos contra script re-ejecutable):**
  1. Gate de entrada nuevo (`scripts/authgate.*`, corre contra local y prod):
     join con JWT válido → entra con handle/role correctos; join con token dev
     (`btoa("dev:x")`) con DEV_NO_AUTH=0 → 401; join con token expirado → 401;
     join con token firmado con el secreto VIEJO (post-rotación) → 401; join
     con role fuera del enum → rechazado.
  2. Flujo de invitado E2E: `?invite=<jwt>` (o código en Antesala) →
     `/api/invite` → Antesala → entra. Probe sin pasos manuales.
  3. Rotación verificada: token con secreto viejo → 401; con secreto nuevo →
     OK. Secretos viejos documentados como rotados en el handoff.
  4. LiveKit fuera de --dev: probe de voz contra prod con llaves nuevas →
     token mintea y la sala LiveKit acepta el join; Admin API `ListRooms` con
     llaves nuevas responde; con `devkey/devsecret-change-me` → falla auth.
  5. **Los gates y probes siguen funcionando con DEV_NO_AUTH=0:** el flujo
     `?probe=` obtiene JWT vía el endpoint admin (ADMIN_TOKEN en env del
     runner, NUNCA hardcodeado en el repo). Gate A + avatarprobe + authgate
     contra prod, todos PASS con auth apagada para dev.
  6. Sin regresión: gates locales 4/4 tras cada deploy de la fase; Tito entra
     desde 2 dispositivos con link de invitado al final.
  7. Rollback documentado ANTES de cada compose.update (procedimiento
     estándar: guardar copia real del compose, pin anterior).
  8. **Separación de salas LiveKit por entorno (H17):** el nombre de sala
     viene de env (`LIVEKIT_ROOM`; prod=netspace-world, local=netspace-dev).
     Probe: un cliente contra el server LOCAL aterriza en netspace-dev y NO
     ve/oye a nadie de prod; Admin API confirma 2 salas distintas.
  9. **Aislamiento de probes:** el flujo `?probe=` NO conecta a LiveKit (o
     conecta con canSubscribe:false y jamás suscribe audio). Verificación:
     Admin API muestra que un probe nunca aparece como suscriptor de tracks
     ajenos; los gates de convergencia siguen PASS (no necesitan audio).
- Riesgo: **medio** (si sale mal, nadie entra — por eso el gate de entrada se
  construye y pasa contra LOCAL primero, luego contra prod con DEV_NO_AUTH=***
  todavía en 1, y solo al final se apaga).

### Fase 6 — Roles + moderación (base de casi todo)
- Objetivo: roles de la visión + moderación real (H10, H11).
- Cambios: mapeo de roles (3 de moderación + roles de zona); comandos por
  mensaje (`mod:mute`, `mod:kick`, `mod:ban`) con enforcement server-side;
  muteo impuesto NO reversible por el usuario (el server rechaza `state
  micOn:true` si `mutedBy` está activo); ban por sesión (memoria) y permanente
  (archivo JSON — la memoria muere con el restart); colores sobrios por rol en
  burbuja/píldora.
- Dependencias: 5b (los comandos requieren auth real para que un kick/ban
  signifique algo).
- Criterios: probes E2E — admin mutea → el usuario no puede desmutearse; kick →
  el cliente sale y no re-entra con el mismo token; ban permanente sobrevive un
  restart del server.
- Riesgo: **medio-alto** (toca schema, auth y UI a la vez).

### Fase 7 — Barra de acciones flotante + emojis (valor rápido, independiente)
- Objetivo: mic on/off + 4 emojis flotantes sin conteos (visión 3.6).
- Cambios: módulo `actionbar.ts` (DOM fijo abajo, safe-area-inset); mensaje
  `emoji` broadcasteado; animación flotante en cliente.
- Dependencias: ninguna dura; si va después de la 6, en modo broadcast se puede
  dejar viva (la visión lo pide).
- Criterios: 2 navegadores — el emoji de A flota en B en <500ms; barra usable en
  Android (tap targets ≥44px, safe-area).
- Riesgo: **bajo**.

### Fase 8 — Megáfono + modo broadcast estricto
- Objetivo: visión 3.2.
- Cambios: megáfono = mensaje server→clientes "suscríbete al admin a volumen
  full sin importar distancia" (cliente: override en `updateSubscriptions` +
  gain forzado); broadcast estricto = server re-mintea tokens con
  `canPublish:false` a los asistentes (o LiveKit API `MutePublishedTrack`) +
  rechaza `state micOn:true` mientras dure; al terminar, restaurar estados.
- Dependencias: Fase 6 (quién puede activarlo), H11 (`inStage` por fin se usa).
- Criterios: con broadcast activo, un asistente no puede publicar (probe:
  `canPublish:false` en su token nuevo); el admin se oye en todo el mapa; los
  emojis siguen flotando.
- Riesgo: **medio** (re-mint de tokens en caliente es el punto delicado).

### Fase 9 — Áreas protegidas + zona multimedia
- Objetivo: visión 3.4.
- Cambios: **zonas como DATA, no código** (ver "Lo que se nos pasó" #2): config
  JSON por evento con salones privados (password opcional validado server-side),
  stands (zona + presentador asignado), zona multimedia (iframe embebido en
  overlay DOM, tiles de la zona bloqueados para pararse encima — `validateMove`
  ya lo soporta — y audio broadcast opcional).
- NO incluye editor visual de zonas (ver "Lo que NO hacer"): las zonas se
  definen en el JSON del evento.
- Dependencias: Fase 6 (roles), decisión de mapa-como-data.
- Criterios: attendee sin password no entra al salón (probe); el embed no se
  puede pisar; el audio de la zona se oye en todo el mapa solo si el admin lo
  activa.
- Riesgo: **medio-alto** (es la primera feature que cambia el modelo de mapa).

### Fase 10 — Cola de preguntas (barata tras la 6)
- Objetivo: visión 3.5 (levantar la mano).
- Cambios: mensaje `queue:raise`, lista ordenada para el moderador, "dar piso"
  = unmute temporal del asistente.
- Dependencias: Fase 6; en modo presentación (Fase 8) brilla.
- Criterios: 3 asistentes levantan la mano → el moderador los ve en orden y da
  piso al primero (probe E2E).
- Riesgo: **bajo**.

### Fase 11 — Registro 3 niveles + Heysummit
- Objetivo: visión 4 (diseño Heysummit en sección 5).
- Cambios: nivel 1 = link público (ya existe); nivel 2 = email con verificación
  (requiere SMTP — costo nuevo de infra, decidir proveedor); nivel 3 = guest-list
  check contra HeySummit API (sección 5).
- Dependencias: 5b (auth real), Fase 6 (roles por evento).
- Criterios: email registrado en HeySummit entra; email no registrado recibe
  mensaje claro (validación dura, preferencia de Tito); token con `exp` al
  cierre del evento.
- Riesgo: **medio** (SMTP es la incógnita; Heysummit ya está verificado).

### Fase 12 — Stage recording + snapshot del mapa (la más cara, al final)
- Objetivo: visión 3.3.
- Cambios: grabación vía **LiveKit Egress** (API de grabación del propio SFU —
  no reinventar): track-composite de los participantes cercanos al admin,
  seleccionados por "quién habla" (niveles de audio por track, ya disponibles
  en LiveKit); snapshot del mapa = render del state final (server-side SVG o
  canvas — barato) con descarga para todos o solo admin (decisión del admin).
- Dependencias: Fases 6 y 8 (roles, quién es "el admin"), storage para los
  archivos (disco del VPS o S3-compatible).
- Criterios: evento de prueba grabado → el archivo contiene el audio de quienes
  hablaron cerca del admin; snapshot descargable con los avatares en su posición
  final.
- Riesgo: **alto** (Egress, storage, y la lógica de selección son terreno nuevo).

### Lo que recomiendo NO hacer (más problema que beneficio)

1. **Mensajes privados (panel DM) — NO por ahora.** La visión misma lo marca
   "secundario, si es barato". No es barato de verdad: DM entre asistentes sin
   herramientas de reporte/bloqueo es un vector de acoso en eventos de terceros,
   y "barato de código" se vuelve caro de moderación. El caso de uso real
   (pasar un contacto) se resuelve más barato con **tarjeta de contacto opt-in**
   (el usuario activa "compartir mi email" y su píldora lo muestra). Revisitar
   solo cuando exista moderación de contenido.
2. **Editor visual de zonas para el admin (arrastrar áreas en vivo).** Superficie
   enorme (UI de edición, validaciones, persistencia, sincronización). El JSON
   de zonas por evento cubre el 90% del valor con el 10% del costo. El editor
   puede venir después de templates, si los clientes lo piden.
3. **Reintroducir volúmenes calculados en server.** El cliente ya tiene todas
   las posiciones vía schema; cualquier cálculo de proximidad server-side es
   egress desperdiciado (H3). La única excepción futura: si el server necesita
   proximidad para recording (Fase 12), se calcula server-side SIN broadcastar.

### Lo que se nos pasó (decisiones baratas HOY que evitan retrabajo)

1. **Sala por evento, no una "world" única.** Hoy TODO entra a la sala "world".
   Para rentar a terceros hace falta `event:<slug>` por evento. Barato hoy: el
   JWT ya lleva claims — agregar claim `event` y crear salas por nombre
   on-demand (misma `WorldRoom`). Si se deja para después, rompe auth, gates y
   el matchmake determinista recién arreglado.
2. **Mapa como DATA servida por el server.** Hoy el mapa vive en DOS copias
   (`world.ts` server + `constants.ts` cliente — espejo manual, ya mordió
   antes). Mover zonas/muros al state de la sala (o a un payload versionado al
   join) elimina la duplicación Y es el prerrequisito de templates/white-label.
   Barato ahora; carísimo si se hace después de la Fase 9.
3. **Reconexión de Colyseus (`allowReconnection`).** Móvil es ciudadano de
   primera y una caída de red hoy deja al usuario como ghost para los demás.
   Colyseus 0.15 lo soporta; es poco código y alto valor percibido.
4. **Métricas mínimas (`/api/metrics`).** Clientes conectados, salas, egress
   aproximado. La próxima pregunta de escalabilidad debe responderse con
   números MEDIDOS, no estimados — y hoy no hay instrumentación.
5. **Persistencia mínima de bans** (archivo JSON). Un ban "permanente" que vive
   en memoria muere con el primer restart del contenedor.

---

## 4. Escalabilidad: ¿hasta dónde llega el setup actual?

**Medido (real, no estimado):** gates con ≤10 clientes concurrentes; eventos
reales de Tito con ~2–6 usuarios. **No existe ninguna medida más allá de eso.**
Todo lo siguiente es ESTIMADO con justificación.

### Techos del setup actual (Dokploy + Colyseus + LiveKit, un VPS)

| # | Cuello | Dónde | Techo estimado | Confianza |
|---|--------|-------|----------------|-----------|
| 0 | `maxClients = 150` | `worldRoom.ts:70` | 150 concurrentes (duro, por código) | cierto |
| 1 | Broadcast de proximidad O(N²) | `worldRoom.ts:218` | ~40–60 en evento DENSO (todos cerca); ~100–150 dispersos | estimado, ver cálculo |
| 2 | Un AudioContext por voz remota | `voice.ts:87` | ~10 voces cercanas por cliente | estimado (límite de navegador) |
| 3 | Sync de schema Colyseus (deltas) | Colyseus core | ~150–300 por proceso | estimado (benchmarks públicos) |
| 4 | Ancho de banda LiveKit (forwarding) | host LiveKit | ~100–150 con video denso | estimado, ver cálculo |

**Cálculo del cuello 1 (el que pega primero):** la matriz N×N se broadcasta 5
veces/seg a TODOS. Con 50 clientes densos: 50×50 entradas × ~25 bytes ≈ 62KB por
broadcast → 312KB/s por cliente → ~15.6MB/s (125 Mbps) de egress total. Un VPS
típico con 100–200 Mbps se satura ahí. Con 150 densos serían ~3.4 Gbps — o sea,
en la práctica un evento denso muere entre 40 y 60 personas HOY.

**Cálculo del cuello 4:** LiveKit reenvía solo tracks suscritos (el cliente
acota por proximidad, ≤ ~8–20 cercanos). Con 150 usuarios y 8 suscripciones de
video por usuario a ~400 kbps: ~480 Mbps en el host LiveKit. El video denso mata
al host LiveKit antes que a Colyseus. Mitigación ya presente: simulcast +
adaptiveStream + dynacast (`voice.ts:15`).

### Qué se necesita para el siguiente nivel

1. **Fase 5a (hotfix):** elimina los cuellos 1 y 2. Techo estimado resultante:
   **150–300 concurrentes por VPS** (el cuello 3 pasa a mandar). Es el cambio
   con mejor ratio valor/esfuerzo de todo el plan.
2. **Load test real** (gate de carga con N bots): subir `maxClients` solo con
   números medidos de CPU/egress. Sin esto, cualquier cifra >150 es cuento.
3. **300–500:** particionamiento espacial (varias salas Colyseus por región del
   mapa, con traspaso al cruzar) o cluster Colyseus con Redis; LiveKit a VM
   propia con más ancho de banda.
4. **>1000:** multi-instancia detrás de LB con sticky sessions + Redis presence;
   LiveKit multi-node (o LiveKit Cloud). Ventaja del stack: al estar en Dokploy,
   migrar de host es un compose portable — la fricción es baja.

**Respuesta corta para Tito:** hoy, eventos de hasta ~50 personas densas o ~150
dispersas. Con la Fase 5a (una semana de trabajo, riesgo medio-bajo): ~150–300.
Más allá requiere particionar, y es un proyecto aparte que NO conviene pagar
hasta tener clientes que lo necesiten.

---

## 5. Integración HeySummit

**Fuente (v1):** `https://app.heysummit.com/api/v2/schema/` descargado el 14-sep-2026
(OpenAPI 3.1.0, 48 paths). La documentación pública está en
`https://app.heysummit.com/api/v2/docs/`.
**Nota v2:** en la segunda corrida el fetch del schema fue bloqueado por Cloudflare
desde este host (re-intentos con UA y `?format=json` → "Attention Required"). Lo que
SÍ se re-verificó independientemente vía búsqueda pública en esta sesión: existencia
de la API v2 con auth `Token`, endpoints de attendees (crear/actualizar por API),
webhooks outbound con event keys de attendee (`attendee.registered`, etc.) y el
servidor MCP oficial. El endpoint `magic-link` y el filtro `?email=` quedan como
**verificados en v1, pendientes de re-verificar antes de la Fase 11** — el diseño de
abajo sigue siendo el más simple aun si `magic-link` no existiera (no se usa).

### Mecanismos disponibles (verificados)

- **Auth:** `Authorization: Token <API_TOKEN>` — el token se genera por evento
  en HeySummit (Event Setup → API, MCP & Webhooks).
- `GET /api/v2/events/` — listar eventos.
- `GET /api/v2/events/{id}/attendees/?email=<email>` — buscar asistente por
  email (también filtra por `registration_status`).
- `POST /api/v2/events/{id}/attendees/` — crear asistente (email, nombre,
  ticket opcional). Ojo: activa inmediatamente y NO verifica el email.
- `POST /api/v2/events/{id}/attendees/{pk}/magic-link/` → `{url, expires_at}` —
  genera URL temporal de sign-in. **Limitación clave:** el magic link autentica
  en HEYSUMMIT, no en Groove Radius, y su `redirect_url` debe ser relativo o
  del mismo evento de HeySummit. No sirve para autenticar en nuestra plataforma.
- `GET/POST /api/v2/webhooks/` — suscripciones a eventos outbound (CRUD
  completo). Los event keys exactos no vienen en el schema; verificar en la
  consola de HeySummit si existe "attendee registered".

### Diseño propuesto: "guest-list check" (lo más simple que funciona)

1. Config por evento en Groove Radius: `{ heysummitEventId, apiToken, slug }`.
2. En HeySummit se pone como URL del venue: `https://play.turedvirtual.vip/e/<slug>`.
3. El asistente llega → pantalla de gate pide su **email** → nuestro server
   consulta `GET attendees?email=X` contra HeySummit → si está registrado y
   activo, mintea JWT propio (`handle`=nombre, `role`=attendee, `event`=slug,
   `exp`=cierre del evento) → Antesala → entra.
4. Si NO está en la lista: mensaje claro y sin fallback (validación dura,
   preferencia de Tito): "Este correo no está registrado para el evento".
5. Sync de la lista: polling cada 2–5 min durante el evento (simple, suficiente)
   + webhook como upgrade si HeySummit tiene evento de registro.

**Por qué NO el magic-link de HeySummit:** autentica en HeySummit, no en
nosotros; no hay SSO encadenable. El email-check contra la guest list da el
nivel de seguridad adecuado para estos eventos (el riesgo residual — alguien
entra con el email de otro — se mitiga en el nivel 2 con verificación por email
propio). **No inventar SSO propio contra HeySummit: no lo ofrecen.**

---

## 6. Mapa del proyecto para un agente externo

- **Visión del producto:** `docs/VISION-PRODUCTO.md` (qué se construye y por qué).
- **Este plan:** `docs/PLAN-AUDITOR.md` (qué sigue, en qué orden, con qué riesgos).
- **Handoffs operativos** (qué se hizo, con outputs reales):
  `/home/assistant/grooveradius-handoff-sesion-2026-09-14-gates-cd-v2.md` (el más
  reciente) y `/home/assistant/grooveradius-snapshot-para-retomar-2026-09-13.md`.
- **Gates:** `./run-gates.sh` en la raíz del repo (requiere server local :2567
  con `DEV_NO_AUTH=1` y static :4175). Exit 0 solo si 4/4 PASS. Contra prod:
  `PROBE_URL=wss://api.turedvirtual.vip`.
- **Deploy:** push → `compose.update` en Dokploy (la copia en SU base de datos,
  no el compose del repo) con el tarball pineado al SHA
  (`codeload.github.com/rjarem/netspace/tar.gz/<full-sha>`) → `compose.deploy` →
  verificar bundle servido. NUNCA stop/start. Detalles y trampas: skill
  `netspace-mvp` del agente.
- **Reglas duras:** nunca guard client-side con leave+rejoin; nunca dataURL en
  el schema sincronizado; archivos de 250–400 líneas; español mexicano en todo
  artefacto; deploy solo vía compose.update+deploy.

## 7. Plan integrado post-ideaario (v8, 16-sep-2026)

El ideaario del producto final (`~/projects/grooveradius/grooveradius-ideaario-producto-2026-09-15.md`,
33 ítems) quedó integrado al plan. Veredicto ítem por ítem, correcciones con
evidencia y disputas: `~/projects/grooveradius/auditor-respuesta-2026-09-16-ideaario-y-plan.md`.

Correcciones de hecho clave: (1) el ítem 27 (foto avatar) NO está bloqueado —
H13 se cerró el 15-sep (PHOTO_BUDGET=16000 en `greenroom.ts:168`, techo real
medido 1.1MB, `payloadprobe.ts` permanente); (2) pinch-zoom (ítem 31) ya está
hecho (Fase 4); (3) suscripción por distancia + dynacast (ítem 26) ya existen
(`voice.ts:184-195`, `voice.ts:30`).

Nuevo orden de fases (sustituye el orden de las viejas 6-12; el plan operativo
de 5b NO cambia): **6** roles+moderación (sin cambios) → **7** pulido+robustez
(toolbar shell con mute/emojis+frases/Salir, fade halos, halo hablando vía
audioLevel, halo por rol, reconexión Colyseus, diagnóstico Brave/Safari,
/api/metrics) → **8** evento (megáfono, Stage multi-speaker, broadcast, "pedir
la palabra" — fusión viejas 8+10 —, compartir pantalla, modo grid) → **9**
espacios y accesos (sala por evento, mapa como data, espacios privados, embeds,
panel de reglas del organizador, tabla de invitaciones + cuota default 3, foto
de grupo) → **10** networking (perfil opt-in, tarjeta de contacto,
quick-reference; badge solo en modo evento tras prototipo) → **11** registro
3 niveles + HeySummit → **12** grabación egress (al final). Anti-feedback: solo
detector de saturación (80%), post-12. Subir archivos: NO autorizado (disputa 1
para Tito). Escalabilidad: load test por disparador (>50 personas), no bloquea
fases (disputa 2 para Tito).

## Registro de cambios

- v1 (14-sep-2026): primera versión. Fase 4 autorizada con 6 condiciones
  (incluye corrección: NO `DEV_NO_AUTH=0` en este deploy). 12 hallazgos de
  auditoría (H1–H12). Plan de 9 fases (4–12). Escalabilidad: techo real hoy
  ~50 densos / ~150 dispersos; ~300 tras Fase 5a. Heysummit: guest-list check
  contra API v2 (magic-link descartado, no autentica en nuestra plataforma).
- v2 (14-sep-2026, segunda corrida con modelo kimi-k3 vía OpenRouter):
  re-verificación independiente de H1–H12 contra el código — TODOS confirmados
  con cita exacta (onAuth worldRoom.ts:154-165; cliente solo envía token dev
  main.ts:107 y cero refs a `invite`; broadcastProximity worldRoom.ts:218-231
  con consumidor vacío main.ts:338-340; AudioContext por track voice.ts:87;
  move sin cap worldRoom.ts:91-100 vs drag con cap :104-114; spawn
  `4 + clients.length` :173; maxClients=150 :70; compose del repo corrupto
  confirmado — labels huérfanos tras `command: --dev` de livekit; main.ts 425
  líneas). Veredicto de Fase 4 y las 6 condiciones se mantienen exactas.
  HeySummit: schema no re-descargable en esta sesión (Cloudflare); endpoints
  marcados para re-verificación antes de Fase 11.
- v3 (14-sep-2026, noche): Fase 4 CERRADA tras 6 deploys verificados y prueba
  real de Tito (3 dispositivos simultáneos). Nuevos hallazgos H13 (techo uWS
  ~4.5KB — el maxPayload 1MB no se respeta; compresión sin margen), H14 (sin
  bloqueo duro por versión — bundles mezclados indistinguibles de bug), H15
  (muro invisible: cap de drag evaluado contra dos referencias — local
  optimista vs última aplicada). Fase 5a ampliada con H13/H14 + chequeo
  automatizado de dist fresco + Gate C prod pendiente. Decisiones de Tito
  registradas: sin DMs, hardening antes que UI, zonas JSON→editor híbrido,
  auth dev hasta 5b. Siguiente bloque autorizado: Fase 5a+5b.
- v4 (15-sep-2026, madrugada): Fase 5a partes 1+2 VALIDADAS contra código y
  prod (HEAD 2c5673c). H13 cerrado por medición (el techo 4.5KB era del
  server viejo; probe permanente payloadprobe.ts: 58KB OK / 1MB vivo / 1.1MB
  DEAD). H14 v4 aceptado (auto-reload una vez por cambio de serverBuild en
  localStorage; pulido pendiente: no recargar a mitad de la Antesala).
  broadcastProximity eliminado, AudioContext compartido, cap en move, spawn
  con wrap — todos verificados en código. GATE C-PROD PASS 5/5: pendiente
  formal de Fase 4 CERRADO. Decisiones: PHOTO_BUDGET sube a 16KB (techo real
  1MB, validación server 60KB); prueba de carga diferida con disparadores
  (>50 personas o subir maxClients); resto de 5a (enganchar check-dist-fresh
  a run-gates + pre-push, limpiar restos de radio en shared) ANTES de 5b.
- v5 (15-sep-2026): FASE 5a CERRADA (HEAD ee55950, verificado: pre-push hook
  activo, 0 restos de proximidad en shared, PHOTO_BUDGET=16000, bundle
  trackeado, prod==dist). Incidencia de deploy documentada (bundle no
  trackeado → 404 en /assets/): corrección de fondo = gate pre-push de bundle
  trackeado, CONDICIÓN PREVIA a 5b. Encimado de avatares registrado como
  comportamiento conocido sin criterio (soft-collision futura si molesta).
  Botón "Salir" registrado como micro-tarea post-5b. FASE 5b AUTORIZADA con
  orden (1) auth real → (2) rotación → (3) LiveKit fuera de --dev → (4)
  DEV_NO_AUTH=0 al final, y 7 criterios de aceptación medibles (incluye:
  gates/probes deben seguir funcionando con auth apagada vía endpoint admin).
- v6 (15-sep-2026): bug P0 reportado por Tito — el que habla calla a todos
  (un segundo hablante no lo oye NADIE). Registrado como Fase 5c con
  diagnóstico-antes-de-fix: inspección de voice.ts descarta el render
  (cadenas por pista correctas); sospechosos S1 publish / S2 subscribe+
  dynacast / S3 render / S4 OS móvil. Gate nuevo: 3 clientes headless con
  fake-media + AnalyserNode RMS por cadena remota — 2 hablantes simultáneos
  audibles. Orden actualizado: gate bundle-trackeado → 5c → 5b. El audio
  multi-hablante NUNCA se había validado (prueba del fade diferida desde
  13-sep) — el bug puede ser anterior a 5a.
- v7 (15-sep-2026): FASE 5c CERRADA — causa raíz real (doble ejecución de
  onRemoteAudio: 2ª MediaStreamSource sobre el mismo stream queda muda en
  Chrome; intermitente por timing de join), fix idempotente verificado en
  código (voice.ts:106-107), probe permanente voiceprobe3 + voicetest, gate
  RMS 6/6 PASS, confirmado por Tito con 3 dispositivos en cuartos separados.
  Nuevo hallazgo H17: sala LiveKit hardcodeada "netspace-world" compartida
  entre local/probes/prod (sesión real convivió con probes — privacidad).
  5b RE-AUTORIZADA con 9 criterios (agregados: 8 separación de salas por env
  LIVEKIT_ROOM, 9 probes nunca suscriben audio). Gate pre-push de bundle
  trackeado: APROBADO, sigue pendiente — es el paso 0 de 5b.
- v8 (16-sep-2026): ideaario del producto (33 ítems) integrado al plan — nueva
  sección 7 con el orden de fases 6-12 re-planificado. Correcciones de hecho:
  ítem 27 (foto avatar) desbloqueado desde el 15-sep (PHOTO_BUDGET=16000),
  pinch-zoom ya hecho, suscripción por distancia ya existe. NO autorizado:
  subir archivos (disputa 1 para Tito). Anti-feedback reducido a detector de
  saturación. Networking recibe fase propia (10) entre espacios y HeySummit.
  Respuesta completa: `~/projects/grooveradius/auditor-respuesta-2026-09-16-ideaario-y-plan.md`.
  Sin autorizaciones nuevas — el plan operativo de 5b sigue vigente.

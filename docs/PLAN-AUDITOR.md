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
**5a. Escala (riesgo: medio-bajo)**
- Objetivo: eliminar los cuellos H3, H4, H5, H6 + los nuevos H13, H14.
- Cambios: borrar `broadcastProximity` del server (el cliente ya calcula todo
  local); UN AudioContext compartido en `voice.ts`; cap anti-teleport en `move`;
  spawn con wrap; **raíz del techo uWS (H13):** configurar el maxPayload real
  de uWS o fijar el techo documentado + bajar el objetivo de compresión de
  foto a ≤4KB (margen); **bloqueo duro por versión (H14):** overlay
  "Actualiza la página" cuando el build del cliente ≠ `serverBuild`;
  **chequeo automatizado de dist fresco** (pre-push o en run-gates.sh: fallar
  si `packages/server/dist` es más viejo que `src` — la lección 1 del día no
  puede depender de disciplina).
- Dependencias: ninguna.
- Criterios de aceptación medibles:
  - Gate de carga nuevo: N bots headless (N≥20) en la sala, egress del server
    medido (bytes/s) ≤ 20% del egress actual a igual N.
  - Con 12 bots cercanos publicando audio, el cliente mantiene UN AudioContext
    y todas las voces suenan (probe con niveles de gain > 0).
  - Probe: `move` con salto de 50 tiles → rechazado; drag sigue igual.
  - Probe: mensaje WS de 8KB → o bien pasa (uWS configurado) o bien el techo
    documentado se valida; foto comprimida siempre ≤4KB.
  - Cliente con build viejo contra server nuevo → overlay de recarga (no
    sesión degradada).
  - Gate C contra PROD ejecutado (cierra el pendiente formal de Fase 4).
- Riesgo: **medio-bajo** (toca audio, que es lo más delicado; mitigación: gates
  de voz existentes + prueba de Tito).

**5b. Seguridad/auth (riesgo: medio)**
- Objetivo: cerrar H1 y H2.
- Cambios: cliente aprende a pedir token real (flujo: link con `?invite=<jwt>` o
  campo "código de evento" en la Antesala → `/api/invite`); rotar JWT_SECRET y
  ADMIN_TOKEN; LiveKit fuera de `--dev` con llaves reales (actualizar
  `LIVEKIT_API_KEY/SECRET` del servicio world en el mismo compose); DESPUÉS de
  verificado, `DEV_NO_AUTH=0`.
- Dependencias: 5a no es prerequisito, pero conviene deployarlas juntas.
- Criterios: gate de entrada nuevo (join con token válido → OK; join con token
  dev → 401; join con token expirado → 401); probe de voz con llaves nuevas;
  rollback = compose.update anterior.
- Riesgo: **medio** (si sale mal, nadie entra — por eso gate de entrada primero).

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

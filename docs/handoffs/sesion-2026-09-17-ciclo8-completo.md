# Groove Radius — Documentación completa del día 2026-09-17 (Ciclo 8)

## Qué se hizo hoy (resumen ejecutivo)

Ciclo 8 COMPLETO y en PRODUCCIÓN. 6 commits pusheados, deploy verificado.
Implementamos la capa de moderación visual/firma del auditor: la capa de
moderación existía server-side pero el cliente no la mostraba (funcionaba
"para nadie"). Hoy la hicimos real, jerárquica y con confirmaciones.

## Trabajo realizado (por fase)

### 8.0-fix — `77b6d72` — firma del auditor (gate 9/9)
- **Problema que encontró el auditor:** los getters `role`/`inStage` de
  PlayerUI se llenaban solo en `addPlayer` — cualquier jugador que entrara
  ANTES de que otro recibiera su rol veía la capa de mod como si no existiera.
- **Solución:** getters lazy que leen el estado vivo del server + reactividad
  por evento `gr-role` (cero trabajo por frame). `mod:role` en vivo funciona
  sin recarga para todos.
- Lección: estado espejado en el cliente NUNCA se copia en el momento del
  add; se lee lazy o se escucha.

### 8.1 — `be5c618` — badge global de megáfono (gate 5/5)
- Cuando alguien usa el megáfono, TODOS ven "📢 [handle] habla a TODO el
  evento" + badge 📢 en su fila de la userlist.
- Solo lectura de `megaphoneBy` vía onStateChange — cero cambios server.

### 8.2 — `5c00973` — espejo mayTouch + confirmaciones + toast (gate 6/6)
- La userlist replica la tabla RANK del server: un moderator ya NO ve
  🙊👢⛔ sobre otro moderator ni sobre admin (el cliente solo muestra lo
  que el server aceptaría).
- 👢 (kick) y ⛔ (ban) exigen `window.confirm` con advertencia explícita
  ("ES PERMANENTE y no hay undo desde el cliente").
- Toast "✓ acción enviada: [target]" para el moderador que ejecuta (antes
  no sabía si aplicó).
- Gate verifica: jerarquía, cancel no envía nada, kick REAL end-to-end
  (target recibe "👢 Fuiste expulsado").

### 8.3 — `feca6f5` — botón 🌐 admin (gate 4/4)
- El admin pica 🌐 → el SERVER mintea JWT admin 1h + shortlink (rate
  5/día por admin). El cliente NUNCA ve ADMIN_TOKEN.
- Copia el link y abre la sala autenticada en pestaña nueva.
- JWT verificado: role=admin, exp ≈ now+1h. Shortlink resuelve.
- Attendee que intenta `admin:mint` → rechazado (server-side).

### 8.4 — `3524b4c` — menú contextual clic-derecho (gate 4/4)
- Clic derecho (desktop-only) sobre OTRO jugador → menú de moderación
  reutilizando EXACTAMENTE la lógica del 8.2 (mayTouch + confirm).
- El clic derecho NO mueve el avatar (click-to-move intacto — assert
  explícito).
- ⭐ Hacer moderador / ☆ Degradar en vivo desde el menú.
- Sin permisos (mod sobre mod/admin) → no hay menú (igual que el server).

## Regresión final (server fresco por suite — regla del auditor)
voice-reconnect 8/8 · voice-token 7/7 · ciclo5 12/12 · ciclo6b 8/8 ·
ciclo61 11/11 · modrole 5/5 · gates nuevos 28/28 = TODO VERDE.

## Deploy a prod (autorizado por Tito en chat)
- compose.update (SHA ×3) → read-back verificado → compose.deploy.
- Verificación: health ok/devAuth:false · bundle prod == bundle local
  (index-BJQfgym1.js) · secretos y volumen intactos.
- **Prod = `210c40b`.** Rollback disponible: compose pinneado a `e37c3bf`
  (guardado en /tmp/gr-compose-current.yaml).

## Errores y lecciones del día
1. **Headless Chrome no emite `Page.javascriptDialogOpening` de forma
   fiable** (7ª incidencia de entorno). Patrón de solución documentado:
   stub de `window.confirm` + marcador `window.__grConfirmSeen` para
   verificar que el diálogo pasó. Usado en gates 8.2 y 8.4.
2. **Los click handlers de botones normales usan `onclick`** — el dispatch
   de PointerEvent synthetic no dispara `.click()` de Phaser/DOM simple;
   en gates usar `b.click()` salvo handlers de pointer reales (8.4 usa
   Input.dispatchMouseEvent real porque el picking es de canvas).
3. **PlayerUI usa `sprite` (rectangle de Phaser), NO `container`** — el
   picking del clic derecho lee `ui.sprite.x/y`. Error de 30 min evitable
   leyendo addPlayer antes.
4. **compose.one read-back**: el JSON anida composeFile a profundidad
   distinta según el endpoint — buscar recursivo, no asumir `data.composeFile`.
   (Falsa alarma de "compose dañado" por forma de parseo.)
5. **gate-auth 3 FAIL preexistente (para el auditor):** mintea con
   `hours:-1` esperando token expirado, pero invite.ts clampa desde el
   Ciclo 5 (`Math.max(1, hours)`) — no existe forma de mintear expirado,
   el test usa una premisa obsoleta. Sin riesgo real; el gate hay que
   reescribirlo para mintear un JWT expirado directamente (sin /api/invite).
6. **Docker de LiveKit para gates locales**: el e2e de voz falla con
   "LiveKit no disponible" si el contenedor no está levantado ANTES de la
   suite — las 2 suites de voz consumen el mismo server pero rate-limits
   separados por suite con server fresco.
7. **Procesos de fondo (http.server, node dist)** — matarlos SIEMPRE al
   cerrar el día + `docker rm -f` del livekit de gates. Verificado 0 procs.

## Pendientes (backlog vivo)
- Avatares encimados: colisión server-side + empuje suave (decisión Tito).
- Long-press mobile para menú contextual (o descartar — pregunta abierta).
- Gate-auth 3: reescribir test para mintear expirado directamente.
- Mapa como overlay bajo demanda + barra minimalista monocromática
  (ideas de Tito del 16-sep, documentadas en mejoras-ux).
- Tercer review externo: propone Tito cuándo (hay 5 commits de ciclo 8).

## Preguntas abiertas para el auditor
1. ¿Rate 5 links admin/día es razonable o mejor token único revoable?
2. ¿Long-press mobile entra en ciclo 9 o se descarta?
3. ¿El gate-auth 3 lo reescribimos o lo retiremos (el clamp hace imposible
   el escenario)?

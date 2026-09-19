# Handoff — Sesión 2026-09-18 · Ciclo 9 completo (GO firmado)

## Resumen
Ciclo 9 (fricción/auth) implementado, verificado y firmado GO por el auditor.
Prod desplegada y verificada en vivo. Ciclo 10 firmado con mini-plan.

## Commits del ciclo (HEAD docs: 4788e81)
- `54ff798` — **9.2** rate-limit auth admin: `adminGate()` choke point único en
  los 5 endpoints admin (invite, shortlink, shortlinks GET, revoke, mod); solo
  cuentan fallos CON header; 6º intento → 429; éxito resetea; mapa separado de
  ipWindow; limiter ws `admin:mint` 5/3min por sessionId (worldRoom:320-333);
  vía creador-JWT del revoke preservada. gate-9-2 6/6.
- `f878d05` — **9.1** sesión persistente cliente puro: gr-invite/gr-invite-exp/
  gr-handle/gr-photo; role=admin NUNCA persistido; expirado→limpieza+hint;
  botón olvidar (solo invitation keys — enmienda auditor: handle/foto son
  preferencia de dispositivo, no credencial); sin auto-join. gate-9-1 6/6.
- `eacf183` — **9.3** poda vs rejoin (solo verificación): escenarios A/B/C del
  auditor; duplicado transitorio se auto-resuelve; respuesta a #12: sin
  allowReconnection el sistema converge. gate-9-3 8/8.
- `51995ec` — harness: gates 8.x handle incondicional (gr-handle heredado en
  chrome compartido — 2º usuario entraba con handle del 1º).
- `4788e81` — **AGENTS.md** nuevo en raíz (índice de fuentes canónicas).

## Deploy y verificación en prod (2026-09-18)
Pin manual 51995ec ×3 en Dokploy (4788e81 es docs-only). Verificado en vivo:
- bundle `index-CBDe5Cti.js` servido; devAuth:false
- `mintcheck-prod.mts` → MINT_OK role=admin ttl=60min code=sí
- rate-limit empírico contra prod: 5×401 → 429 en el 6º (header incorrecto),
  401 limpio sin header; /api/shortlink y /api/shortlinks también 429 en lockout

## Regresión final (auditor, independiente)
Todo verde: 9.2 6/6 · 9.1 6/6 · 9.3 8/8 · ciclo61 11/11 · ciclo5 12/12 ·
modprobe 10/10 · modrole 5/5 · ciclo6b 8/8 · 8.0 9/9 (tras su parche) ·
8.1-8.4 verdes · voz 8/8 y 7/7 · A-D A+B (C/D firefox — incidencia #8).
ciclo6: 8/8 en la corrida del auditor — los 3 fails de cámara previos quedan
como nota ambiental (LiveKit local caído era la causa raíz principal).

## Lecciones de la sesión
1. LiveKit local caído (= higiene que elimina docker) rompe 8.1-e y cámara de
   ciclo6 — verificar 7880 antes de culpar código.
2. Persistencia gr-handle × harness: todo gate con 2+ usuarios en un chrome
   debe poner handle incondicionalmente (51995ec + parche del auditor en
   gate-8-0, incluido en este commit).
3. Mismo patrón de fallo, dos corridas distintas: los fails ambientales se
   replican SIN el cambio antes de culpar código.

## Siguiente: Ciclo 10 — avatares encimados (FIRMADO)
Mini-plan: `~/projects/grooveradius/plan-ciclo10-avatares-encimados.md`
- Radio de colisión 0.5 tile APROBADO (aglomeración parcial, sin oclusión total)
- Empuje server-forced respetando H15, sin consumir el cap del empujado
- Precisiones auditor: barrido iterativo acotado (máx 3 pasadas), declarar en
  comentario dónde corre el sweep (worldRoom es message-driven, no tick),
  criterio 6 = ciclo6 verde
- Cero voice.ts; diff solo worldRoom.ts + main.ts (interpolación) + gates

## Después del Ciclo 10
Load test (FIRMADO con precisiones integradas): correrlo DESPUÉS del 10 — la
colisión cambia el costo por move; medir antes sería medir un server viejo.
Plan: `~/projects/grooveradius/plan-loadtest-2026-09-18.md`.

## Respuestas del auditor archivadas
- `auditor-respuesta-2026-09-18-ciclo9-go-y-ciclo10-firmado.md` (GO + firma 10)
- `auditor-respuesta-2026-09-18-plan-ciclo9-firmado.md` (8 precisiones originales)

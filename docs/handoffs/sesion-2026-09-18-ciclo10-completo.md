# Handoff — Sesión 2026-09-18 · Ciclo 10 completo (GO firmado)

## Resumen
Ciclo 10 (avatares encimados: colisión + empuje suave) implementado según
mini-plan firmado, verificado en prod por el auditor, **GO firmado**.

## Qué entró
- **Colisión (radio 0.5 tile):** `clampToFree()` — el que llega a un tile
  ocupado se detiene en el último tile libre de su ruta (move y drag).
- **Empuje suave server-forced:** `resolveOverlaps()` — empuja al que NO se
  movió, mínimo desplazamiento, siempre vía `validateMove` (H15, nadie sale
  del mapa), sin consumir el cap anti-teleport del empujado.
- **Sweep inline message-driven, máx 3 pasadas** (precisión auditor: una
  pasada deja solapes en cadena) — corre al final de cada move/drag aceptado;
  declarado en comentario del bloque (P1/P2).
- **Micro-fix autorizado en la auditoría:** `resolveOverlaps` también al
  final de `onJoin` — con churn (leave→join que recicla un tile ocupado)
  el apilado persistía hasta que alguien se moviera.
- **Cero cliente, cero voice.ts.** El cliente ya interpolaba (movement.ts
  tween 110ms) — el empuje se ve como deslizamiento.

## Desviación documentada (exigencia del auditor)
El **"spawn en anillo" del mini-plan NO se implementó y no hacía falta**:
el spawn con wrap de Fase 5a ya da posiciones únicas (gate 10-d pasa por
código preexistente). El gate 10-d valida esa propiedad.

## Gates
`gate-10-collision.ts` **6/6** — (a) 2 bots mismo tile → adyacentes,
(b) 6 bots → 6 únicas, (c) empuje: A llega a donde pidió, B desplazado,
(d) spawn 10 joins → únicas, **(d2) churn: join recicla tile ocupado →
sin apilado tras onJoin**, (e) schema sin NaN.

## Regresión (verde, auditor + implementor)
ciclo61 11/11 · ciclo5 12/12 · modprobe 10/10 · modrole 5/5 · ciclo6 8/8 ·
ciclo6b 8/8 · 8.0 9/9 · 8.1 5/5 · 8.2 6/6 · 8.3 4/4 · 8.4 4/4 ×3 · 9.1 6/6 ·
9.2 6/6 · 9.3 8/8 · A-D A+B (C/D firefox, incidencia #8).

## Prod
Deploy verificado en vivo por ambos: pin `57c0bf2` ×3, MINT_OK, smoke
conductual de colisión (`smoke-collision-prod.mts`): COLCHECK_OK dist=1.41 —
un bot en su tile, otro adyacente, cero apilado. Bundle cliente sin cambios
(el ciclo no tocó cliente). **El micro-fix de onJoin NO está en prod** —
viaja con el próximo deploy.

## Harness (adoptado por el auditor)
- `preflight-env.sh` — paso OBLIGATORIO pre-regresión (propuesto como regla
  dura del PLAN-AUDITOR).
- `killgate-server.sh` — nunca pkill -f directo (auto-suicidio de wrapper).
- Runbook lecciones 1-8: livekit/statics/ADMIN_TOKEN/pkill/server viejo/
  gr-handle/rate-limit invites entre suites/sprites vs tweens.
- Regla de higiene del auditor: no mata gr-livekit-gate ni estáticos con
  gates en curso, y avisa.
- Pendiente no bloqueante (próxima pasada de harness): el else "admin no
  visible → PASS trivial" de gate-8.4-c debe convertirse en FAIL.

## Siguiente
- Load test firmado (mini-plan + precisiones del auditor): listo para
  disparar. Corrección del auditor: /api/invite NO tiene rate-limit por IP
  (el 10/min es de /api/shortlink*) — bots entran con JWT crudo de
  /api/invite, cero shortlinks en el harness; no hace falta pre-mint.
- El costo por move cambió con el sweep (O(n²) en el peor caso): medir con
  esta build, que es la actual.

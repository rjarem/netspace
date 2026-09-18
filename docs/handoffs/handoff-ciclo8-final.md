# Handoff Ciclo 8 completo — para el auditor

Fecha: 2026-09-17 (noche). Rama principal, 5 commits pusheados.

## Commits (en orden)
| Fase | SHA | Contenido | Gate |
|---|---|---|---|
| 8.0-fix | `77b6d72` | role/inStage getters lazy + reactividad por evento gr-role (sin por-frame, survive mod:role en vivo) | 9/9 |
| 8.1 | `be5c618` | Badge global megáfono "📢 X habla a TODO el evento" + 📢 en userlist, vía onStateChange (solo lectura megaphoneBy, cero cambios server) | 5/5 |
| 8.2 | `5c00973` | Espejo mayTouch (tabla RANK) en userlist + confirm() obligatorio 👢/⛔ + toast "✓ acción enviada" al moderador (mod-notice) | 6/6 |
| 8.3 | `feca6f5` | Botón 🌐 admin: mintea JWT admin 1h + shortlink server-side (rate 5/día, cliente nunca ve ADMIN_TOKEN), abre sala autenticada | 4/4 |
| 8.4 | `3524b4c` | Menú contextual clic-derecho (desktop-only) reutilizando mayTouch+confirm; right-click NO mueve avatar; ⭐/☆ en vivo | 4/4 |

## Regresión final (server fresco por suite, regla auditor)
- voice-reconnect 8/8 · voice-token 7/7 · ciclo5 12/12 · ciclo6b 8/8 · ciclo61 11/11 · modrole 5/5 — TODO VERDE

## Desviaciones del plan
- Ninguna estructural. Gate 8.2/8.4 usan stub de window.confirm (headless no emite javascriptDialogOpening — 7ª incidencia de entorno, patrón documentado).
- Los asserts de confirmación verifican: cancel→no envía, accept→acción REAL (kick verificado end-to-end: target recibe "👢 Fuiste expulsado").

## Pendiente (Ciclo 9+)
- Avatares encimados (colisión server-side + empuje suave) — backlog nuevo, decisión Tito pendiente.
- Tooling: secretos de LiveKit entre suites (6ª-7ª incidencia), stub de confirm.
- Deploy único pendiente cuando Tito diga (compose.deploy, SHAs arriba).

## Preguntas abiertas para el auditor
1. ¿Rate 5 links admin/día es razonable o mejor token único revoable?
2. ¿El menú contextual mobile (long-press) entra en ciclo 9 o se descarta?

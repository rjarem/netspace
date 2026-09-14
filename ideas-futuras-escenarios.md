# Ideas futuras — escenarios y refinamientos (propuestas de la esposa de Tito, 12-sep)

## 1. Salón de clases / modo presentación (pre-networking)

**Concepto:** estado inicial de un evento ANTES del networking. Un mapa con imagen de
"sillas" donde se asigna un lugar a cada avatar.

**Punto clave de la idea:** que TODOS puedan ver la transmisión (presentador en vivo o
video embebido) DESDE DONDE ESTÉN — no tener que acercarse a una zona/pantalla como el
embed actual. El modo networking se activa después.

**Viabilidad técnica (para evaluar después):**
- Sillas: trivial — tiles/marcadores asignados por el server (seat map sobre el grid).
  Se puede dibujar un PNG de auditorio como fondo de zona o generar sillas proceduralmente.
- Transmisión global: hay 2 caminos:
  a) **Screen-share del presentador vía LiveKit** ya existe el canal de video; bastaría un
     modo "broadcast" que suscriba a TODOS los participantes al track del presentador
     sin importar la distancia (hoy updateSubscriptions() suscribe solo por proximidad
     ≤ AUDIO_MAX_RADIUS — habría que añadir una excepción para el track del presentador).
  b) **Embed HLS/YouTube** en overlay global (como la idea de stream en vivo del panel
     admin) — más simple, no depende de LiveKit, pero no es "en vivo cámara a cámara".
- Flag de modo: evento en modo "presentation" vs "networking" (server-side, por zona o global).

**Complejidad estimada:** media. La parte de sillas es fácil; la de broadcast global toca
updateSubscriptions() y el flujo de tokens LiveKit.

## 2. Control de micrófono (admin y usuario)

**Concepto:** si varios usuarios se juntan y uno tiene bocinas muy altas mete feedback,
el ADMIN debe poder apagarle el micrófono; y cada USUARIO debe poder mutear el suyo.

**Viabilidad técnica:**
- **Mute propio:** trivial — botón HUD que llame lkRoom.localParticipant.setMicrophoneEnabled(false)
  + indicador visual (🎤⃠). Media hora de trabajo.
- **Mute por admin:** requiere señal server→cliente: el server marca al usuario muteado
  (campo en PlayerState, ej. forceMuted: boolean). El cliente del muteado obedece
  (setMicrophoneEnabled(false) y se queda re-muteando si intenta reactivar mientras el
  flag esté activo). El admin necesita UI: click derecho en píldora → "silenciar".
  El panel admin de zonas (ya en roadmap) es el lugar natural para la lista de usuarios
  con botones de mute.
- **Bonus anti-feedback:** indicador de nivel de micrófono (medidor de volumen local) para
  que el usuario vea cuándo su audio está pegando.

**Complejidad estimada:** mute propio = baja; mute admin = media (toques en server, protocolo
y panel admin).

## Notas
- Ambas ideas encajan con el roadmap existente (panel admin de zonas, embed de stream,
  lista de acceso). Documentarlas aquí para no perderlas.
- La de salón de clases refuerza la necesidad del flag de ROLES ya existente
  (admin/speaker/panelist/attendee/dj) — el presentador sería otro uso de "speaker".

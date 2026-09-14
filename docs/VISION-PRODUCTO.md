# Groove Radius — Documento de Visión v1 (14-sep-2026)

> Estado: borrador acordado entre Tito y el agente implementador en sesión de brainstorming.
> Sirve como contexto base para el auditor y para la planeación de fases. Se irá
> actualizando; los cambios importantes se anotan al final.

## 1. Qué es

Plataforma de eventos virtuales con **presencia espacial**: un mapa 2D de tiles donde
los asistentes aparecen como avatares con foto real. La proximidad ES la sala — el
audio y video aparecen/desaparecen según la distancia (audio con fade exponencial y
paneo; video en vivo al acercarte, burbuja con foto al alejarte). No hay canales de
audio artificiales: te acercas a alguien y conversas; te alejas y la conversación
queda atrás.

**Modelo:** primero para los eventos de Tito (Heysummit, cumpleaños, clases,
presentaciones de producto); eventualmente se renta "el salón" a terceros
(monetización: templates, personalización, white-label).

**Plataformas:** móvil es ciudadano de primera (los invitados llegan del celular),
aunque Tito usa PC el 99%. Toda feature de UI se diseña para ambos.

## 2. Roles

| Rol | Capabilities |
|---|---|
| **Asistente** | caminar/drag, conversar, reacciones (emojis), mensaje privado |
| **Moderador / Presentador** | megáfono, muteo remoto de asistentes, (color distinto de avatar). NO puede banear ni modificar el mapa |
| **Administrador (anfitrión)** | organiza el evento: define áreas en el mapa, roles, kick/ban, muteo persistente, modo broadcast. Color de avatar distintivo (sutil, SIN corona/dorado) |

Regla: **muteo impuesto por admin/moderador no puede desmutearse el usuario solo**
(el admin lo libera).

## 3. Features núcleo

### 3.1 Audio/video espacial (ya existe en parte)
- Fade exponencial de volumen + paneo por posición; radio de audio limitado.
- **Halo de proximidad:** SOLO hace fade in/out al entrar/salir del área de audio.
  Nadie camina con círculos permanentes.
- **Halo verde de habla:** pequeño indicador sobre quien esté hablando (LiveKit da
  niveles por track). Reutilizable para la grabación inteligente.

### 3.2 Megáfono (broadcast)
- El moderador/admin habla a TODOS sin importar ubicación (anuncios, clases).
- **Modo broadcast estricto:** mutea los mics de todos durante la presentación; al
  terminar, cada quien vuelve a su estado. La barra de emojis sigue viva durante
  este modo (es la reacción natural del público).

### 3.3 Stage recording (grabación de evento)
- Se graba **lo que sucede cerca del administrador**: audio de todos los que
  conversan con él + video de lo que está junto a él.
- Implementación sugerida: mezcla guiada por "quién habla" cerca del admin
  (server-side primero, simple). La persona que contrató guarda la experiencia.
- **Snapshot del mapa:** al terminar el evento, foto del mapa (cómo se acomodó la
  gente). Por defecto todos los asistentes la descargan como recuerdo, pero es
  **decisión del administrador** restringirla (solo para él).

### 3.4 Áreas protegidas (definidas por el admin en el mapa)
- **Salón privado:** lo que se dice ahí solo se oye ahí; password opcional.
- **Stands de producto:** N áreas con presentador cada una; la gente va e interactúa.
- **Zona multimedia:** pantalla con video embebido (iframe); no se puede parar
  nadie encima; audio en modo broadcast opcional (todos lo oyen desde cualquier
  punto del mapa).

### 3.5 Herramientas de presentador
- Compartir pantalla, imágenes, archivos (lo básico de videoconferencia).
- **Cola de preguntas ("levantar la mano"):** botón en la barra del asistente en
  modo presentación; el presentador ve la lista y le da piso.

### 3.6 Barra de acciones flotante (todos los usuarios)
- Abajo, siempre visible: mic on/off + 3–4 emojis (👍 👎 🙂 ❤️).
- Emoji mandado = flota hacia arriba frente a la pantalla de todos; sin conteos
  ni historial. Reacción en vivo.

### 3.7 Mensajes privados (secundario, si es barato)
- Panel lateral (fuera del mapa): DM de texto entre usuarios.
- Caso de uso: networking — pasar un correo/contacto sin que quede grabado ni
  sea público. Solo si no cuesta mucho código/recursos.

### 3.8 Moderación
- Muteo remoto (mod y admin), kick, **ban por sesión o permanente** (solo admin).

## 4. Registro / autenticación (3 niveles)
1. **Público:** link directo (como hoy) — eventos abiertos.
2. **Email:** registro sencillo con link de verificación por evento.
3. **Integración Heysummit:** grupos de usuarios llegan ya autentificados desde
   Heysummit (tiene API — investigar el mecanismo: SSO/token firmado o links
   mágicos por invitado) → llegan a la Antesala, ponen avatar y entran.
- Espacios privados internos con password.

## 5. Personalización / monetización futura
- Background y temas de color del espacio.
- **Templates de mapa:** aula con asientos fijos (asistentes no se mueven durante
  la clase), layout con mesas, escenario para DJ.
- URLs personalizadas (dominio/evento) → white-label con DNS propio del cliente.

## 6. Escalabilidad (pregunta abierta para el auditor)
- ¿Hasta dónde escala el setup actual (Dokploy + Colyseus + LiveKit)? ¿Cuántos
  usuarios simultáneos por instancia?
- ¿Qué se necesita para el siguiente nivel (Dokploy con más recursos, múltiples
  instancias de Colyseus, particionamiento espacial, límites de LiveKit)?
- Ventaja: al estar en Dokploy, migrar a un host con más recursos debería ser
  razonablemente directo.

## 7. Orden tentativo de fases (a validar por el auditor)
1. **Fase 4 (ya pendiente):** deploy a prod de lo que ya está GREEN (gates A–D).
2. **Fase 3 UI:** burbujas 2 estados + halo de proximidad condicional + halo verde
   de habla.
3. **Roles + megáfono + moderación** (muteo remoto, kick, ban).
4. **Barra de acciones flotante + emojis flotantes.**
5. **Áreas protegidas + zona multimedia.**
6. **Stage recording + snapshot del mapa.**
7. **Registro/Heysummit + espacios con password.**
8. **Personalización, templates, white-label.**

## Registro de cambios
- v1 (14-sep-2026): primera versión tras brainstorming Tito + implementador.
- **Decisiones post-veredicto del auditor (14-sep):** (1) DEV_NO_AUTH=1 se
  mantiene en prod hasta Fase 5b — PROBLEMA CONOCIDO PARA PRODUCCIÓN,
  documentado: cualquiera con el link entra; aceptable solo en etapa de
  pruebas. (2) DMs ELIMINADOS de la visión; en su lugar, tarjeta de contacto
  opt-in como idea futura. (3) Hardening (5a/5b) ANTES de Fase 3 UI.
  (4) Zonas: JSON por evento AHORA + **editor visual de zonas en el plan
  antes de producción** (decisión híbrida de Tito: las zonas viven como DATA,
  el editor será una capa de UI que escribe ese mismo JSON — sin retrabajo).
- **14-sep-2026 (post-brainstorm):** commit `b855a50` — el bypass `?probe=` ahora
  acepta `&probeUrl=<ws-url>` para apuntar los gates headless a PROD
  (`wss://api.turedvirtual.vip`) sin tocar código. Default sigue siendo el server
  local. **Gates A–D re-ejecutados tras el cambio: 4/4 PASS** (TOTAL: 4 PASS /
  0 FAIL). Build cliente nuevo: `index-B3se7K2O.js`. El punto "parametrizar URL
  del bypass" del checklist de Fase 4 queda RESUELTO.
- **14-sep-2026 (misma sesión, hardening del runner de gates):** commit `1aea15b` —
  el runner headless de Firefox usaba SIGTERM (dejaba sockets zombies que se
  re-unían a la sala del round siguiente, contaminando el conteo del Gate D) y
  reciclaba perfiles de Firefox entre corridas. Ahora: SIGKILL + perfiles únicos
  por corrida. **Gates A–D re-ejecutados de nuevo: 4/4 PASS con roomIds nuevas.**
  Nota honesta: una corrida intermedia dio 3/4 (Gate D con "2 salas") por este
  ruido del runner — el juego nunca tuvo splits reales.

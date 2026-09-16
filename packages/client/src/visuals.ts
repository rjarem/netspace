// Ciclo 1 UX (auditor 17-sep, aprobado sin plan formal): mapa-overlay + halos.
// REGLA (Tito): cosméticos — NO tocar updateSubscriptions ni el pipeline
// audio/video. Todo aquí es overlay CSS (mapa) y objetos Phaser visuales (halos).
import { TILE, type PlayerUI } from "./constants";

type SC = any;

// Colores de rol (Tito: admin un color, moderador otro, usuario otro).
const ROLE_COLOR: Record<string, number> = {
  admin: 0xffcf5c,     // ámbar
  moderator: 0x4fd1ff, // cian
  speaker: 0x4fd1ff,
  dj: 0x4fd1ff,
};
const ROLE_COLOR_DEFAULT = 0x8892a8; // usuario normal: gris neutro sutil
const SPEAK_COLOR = 0x7cff9e;        // hablando: verde

export function roleColorOf(p: PlayerUI & { schema?: any }): number {
  const role = String(p.schema?.role || "").toLowerCase();
  return ROLE_COLOR[role] ?? ROLE_COLOR_DEFAULT;
}

/* ---------------- Mapa-overlay (Tito, 17-sep) ----------------
 * Híbrido: tap en el botón abre/cierra; si se abre por botón se auto-oculta
 * a los 7s SI no interactúas (interactuar cancela el timer); moverse 3+ tiles
 * lo cierra. Panel gris neutro claro (#e8eaee) + marco delgadito de acento.
 * El canvas #minimap EXISTENTE se mueve dentro del panel (más grande).
 */
export function installMapOverlay(sc: SC) {
  if (document.getElementById("gr-mapoverlay")) return;
  const mm = document.getElementById("minimap");
  if (!mm) return;

  const style = document.createElement("style");
  style.textContent = `
#gr-mapoverlay { position: fixed; right: 10px; bottom: calc(74px + env(safe-area-inset-bottom, 0px));
  z-index: 75; background: #0b0e16; border: 1px solid #4f7cff; border-radius: 8px;
  padding: 0; box-shadow: 0 4px 18px #000a; display: none;
  opacity: 0; transition: opacity .25s ease; }
#gr-mapoverlay.gr-open { display: block; }
#gr-mapoverlay.gr-shown { opacity: 1; }
#gr-mapoverlay::after { content: "🗺 Mapa"; position: absolute; top: -10px; left: 12px;
  background: #4f7cff; color: #fff; font: 600 11px system-ui, sans-serif;
  padding: 2px 8px; border-radius: 10px; }
#gr-mapoverlay canvas { pointer-events: none; border-radius: 8px; }
`;
  document.head.appendChild(style);

  const ov = document.createElement("div");
  ov.id = "gr-mapoverlay";
  // El minimapa era position:fixed inline — dentro del panel debe fluir normal
  // y AGRANDARSE (Tito: "tan chiquito no se nota"). Subir resolución interna
  // 480×240 (mismo ratio 2:1 del mapa 128×64) para que no se vea pixelado.
  (mm as HTMLCanvasElement).width = 480; (mm as HTMLCanvasElement).height = 240;
  mm.style.cssText = `position:static;width:min(420px,78vw);height:auto;background:#0b0e16;border:none;border-radius:8px;pointer-events:none;`;
  ov.appendChild(mm); // mover el canvas existente dentro del panel
  document.body.appendChild(ov);

  let open = false, hideTimer: any = null, lastXY: { x: number; y: number } | null = null;

  const show = () => {
    open = true;
    ov.classList.add("gr-open");
    requestAnimationFrame(() => ov.classList.add("gr-shown"));
    armHideTimer();
  };
  const hide = () => {
    open = false;
    ov.classList.remove("gr-shown");
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    setTimeout(() => { if (!open) ov.classList.remove("gr-open"); }, 260);
  };
  const toggle = () => (open ? hide() : show());
  const armHideTimer = () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 7000);
  };

  // Interacción con el panel (o dentro de él) cancela el auto-ocultado
  ov.addEventListener("pointerdown", () => { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } });

  // Botón en la actionbar (monocromo)
  const btn = document.createElement("button");
  btn.id = "gr-mapbtn";
  btn.title = "Mapa";
  btn.textContent = "🗺️";
  btn.onclick = toggle;
  const bar = document.getElementById("gr-actionbar");
  if (bar) bar.insertBefore(btn, bar.querySelector("button:last-child")); // antes de Salir

  // Moverse 3+ tiles con el overlay abierto → cerrar
  const watch = setInterval(() => {
    try {
      if (!open) return;
      const me = sc.players?.get?.(sc.myId);
      if (!me) return;
      const cur = { x: me.worldX, y: me.worldY };
      if (lastXY) {
        const d = Math.hypot(cur.x - lastXY.x, cur.y - lastXY.y) / TILE;
        if (d >= 3) { lastXY = null; hide(); return; }
      }
      lastXY = cur;
      if (!sc.room) clearInterval(watch);
    } catch { /* */ }
  }, 400);
}

/* ---------------- Halos por rol + "hablando" (Ciclo 1) ----------------
 * Ring fino bajo cada avatar; color por rol; pulso verde si el SFU lo reporta
 * hablando (RoomEvent.ActiveSpeakersChanged → window.__grActiveSpeakers).
 * El alpha SIEMPRE interpola suave (fade), nunca cambia de golpe.
 * SOLO visual: no toca audio, suscripciones ni bubbles.
 */
export function updateHalos(sc: SC, scene: any) {
  const now = Date.now();
  pollSpeakingLevels((globalThis as any).__lkRoom, sc, now);
  for (const [id, p] of (sc.players as Map<string, any>)) {
    const sp = p.schema;
    if (!sp) continue;
    const speakers: string[] = (globalThis as any).__grActiveSpeakers || [];
    const speakingNow = speakers.includes(id) || speakers.includes(String(p.handle || "").toLowerCase());
    const roleNow = roleColorOf(p);
    const targetColor0 = speakingNow ? SPEAK_COLOR : roleNow;
    if (!p.roleHalo) {
      p.roleHalo = scene.add.circle(0, 0, 19, 0x000000, 0);
      p.roleHalo.setStrokeStyle(3.5, ROLE_COLOR_DEFAULT, 0);
      p.roleHalo.setDepth((p.sprite?.depth ?? 1) - 0.5);
      // Etiqueta SIEMPRE encima de avatares/burbujas (Tito: los nombres de
      // jugadores atrás se recortaban contra el avatar de adelante).
      p.label?.setDepth(100);
      // Fondo de la etiqueta del color del rol (se distingue quién es quién).
      if (p.label) {
        const lblColor = "#" + targetColor0.toString(16).padStart(6, "0");
        p.label.setStyle({ backgroundColor: lblColor + "cc" });
      }
    }
    const speaking = isSpeaking(sc, id, now); // audioLevel RTP + fallback SFU
    const targetColor = speaking ? SPEAK_COLOR : roleColorOf(p);
    // pulso sutil al hablar
    const t = (globalThis as any).__grNow || Date.now();
    const pulse = speaking ? 1 + 0.12 * Math.sin(t / 160) : 1;
    p.roleHalo.radius = 19 * pulse;
    p.roleHalo.setPosition(p.worldX, p.worldY + 6);
    p.roleHalo.strokeColor = targetColor;
    // FADE: al ENCENDER (hablar) es INMEDIATO (responsivo, feedback Tito);
    // al apagarse sí hace fundido suave.
    const targetAlpha = speaking ? 0.95 : (targetColor !== ROLE_COLOR_DEFAULT ? 0.9 : 0.45);
    if (speaking) p.roleHalo.strokeAlpha = targetAlpha;
    else p.roleHalo.strokeAlpha = p.roleHalo.strokeAlpha == null ? 0 : p.roleHalo.strokeAlpha + (targetAlpha - p.roleHalo.strokeAlpha) * 0.2;
    // CAPA HTML (Tito, diagnóstico 17-sep): la burbuja de video/avatar es un
    // div HTML por ENCIMA del canvas — tapa el anillo Phaser. Pintar el rol
    // DIRECTO en la burbuja: borde del color del rol (+ glow verde al hablar).
    // Además: la burbuja YA trae su propia etiqueta de nombre — apagar la del
    // canvas para que no se asome detrás de la burbuja (feedback Tito).
    if (p.label && p.bubble) p.label.setVisible(false); else p.label?.setVisible(true);
    const bub = p.bubble as HTMLDivElement | undefined;
    if (bub) {
      if (!bub.dataset.grRoleStyled) {
        bub.dataset.grRoleStyled = "1";
        bub.style.transition = "border-color .3s, box-shadow .3s";
      }
      const hex = "#" + targetColor.toString(16).padStart(6, "0");
      bub.style.borderColor = hex;
      bub.style.boxShadow = speaking ? `0 0 12px 3px ${hex}` : "0 2px 8px #0009";
      const tag = bub.querySelector("div[style*='background:#000000aa']") as HTMLElement | null;
      if (tag) tag.style.background = hex + "cc";
    }
  }
}

/** Enganchar ActiveSpeakersChanged — LLAMAR SOLO UNA VEZ desde voice.ts. */
export function wireActiveSpeakers(room: any) {
  try {
    const { RoomEvent } = (globalThis as any).__lk || {};
    if (!room || !RoomEvent) return;
    room.on(RoomEvent.ActiveSpeakersChanged, (sp: any[]) => {
      try { (globalThis as any).__grActiveSpeakers = (sp || []).map((s: any) => s.identity); } catch { /* */ }
    });
  } catch { /* */ }
}

/* ================= CICLO 2 (plan auditor 17-sep) =================
 * Guardarraíles: SOLO scale/alpha/transform. PROHIBIDO tocar
 * updateSubscriptions, el corte a 8 tiles, ganancias, movement.ts, schema.
 * - Escala = map(3→8 tiles, 1.0→0.35), clamp [0.35, 1.0]; self nunca escala.
 * - alphaVideo = map(5→7.5 tiles, 1→0) — el fade TERMINA a 7.5, antes del
 *   corte de suscripción a 8 (el corte no se percibe).
 * - Zonas: fade de alpha por proximidad, 200-300ms simétrico.
 * - Latencia del halo: audioLevel RTP vía getSynchronizationSources()
 *   (no analyser, no getStats), umbral 0.03, ataque inmediato, decay 300ms,
 *   throttled ~150ms, fallback a ActiveSpeakersChanged.
 */
const SCALE_MIN = 0.5, FADE_START = 5, FADE_END = 7.5;

function mapScale(distTiles: number): number {
  if (distTiles <= 3) return 1.0;
  const s = 1.0 - ((distTiles - 3) / 5) * (1.0 - SCALE_MIN);
  return Math.max(SCALE_MIN, Math.min(1.0, s));
}
function mapVideoAlpha(distTiles: number): number {
  if (distTiles <= FADE_START) return 1;
  const a = 1 - (distTiles - FADE_START) / (FADE_END - FADE_START);
  return Math.max(0, Math.min(1, a));
}

/** Latencia del halo: lee audioLevel RTP localmente (barato, sin nodos). */
const lastVoiceTs = new Map<string, number>();
let lastPoll = 0;
function pollSpeakingLevels(room: any, sc: SC, now: number) {
  if (now - lastPoll < 150) return;
  lastPoll = now;
  try {
    for (const part of (room?.remoteParticipants?.values?.() || [])) {
      const id = part.identity;
      if (!id || !sc.players.has(id)) continue;
      const pubs = part.trackPublications?.values?.() || [];
      for (const pub of pubs) {
        if (pub.kind !== "audio" || !pub.track) continue;
        const recv = (pub.track as any).receiver;
        if (!recv?.getSynchronizationSources) continue;
        const srcs = recv.getSynchronizationSources();
        const lv = srcs?.[0]?.audioLevel ?? null;
        if (lv != null && lv > 0.03) lastVoiceTs.set(id, now); // umbral auditor
        break;
      }
    }
  } catch { /* fallback silencioso a ActiveSpeakersChanged */ }
}

function isSpeaking(sc: SC, id: string, now: number): boolean {
  // ataque inmediato si el RTP lo dice (decay 300ms), fallback SFU speakers
  if (now - (lastVoiceTs.get(id) || 0) < 300) return true;
  const sp: string[] = (globalThis as any).__grActiveSpeakers || [];
  return sp.includes(id);
}

/** Escalado de avatar/burbuja + fade de video + zonas. LLAMAR CADA FRAME. */
export function updateVisuals(sc: SC, scene: any) {
  const now = Date.now();
  pollSpeakingLevels((globalThis as any).__lkRoom, sc, now);
  const me = sc.players.get(sc.myId);
  if (!me) return;
  for (const [id, p] of (sc.players as Map<string, any>)) {
    if (id === sc.myId || !me) { p.visScale = 1; continue; } // self nunca escala
    const dist = Math.hypot(p.worldX - me.worldX, p.worldY - me.worldY) / TILE;
    // Escala con lerp ~170ms (a 60fps ≈ 0.25)
    const target = mapScale(dist);
    p.visScale = (p.visScale ?? 1) + (target - (p.visScale ?? 1)) * 0.25;
    const l = p.visScale;
    // Avatar Phaser (rect + cara): oculto SIEMPRE que hay burbuja HTML —
    // el avatar lejano NO es la cara cuadrada del canvas, es la burbuja en
    // modo FOTO (redonda, como antes).
    p.sprite?.setScale?.(l);
    if (p.sprite?.faceRef) p.sprite.faceRef.setVisible(!p.bubble);
    // Fade del video: termina a 7.5 tiles, antes del corte real a 8.
    // Lejos (fade agotado): la burbuja entra en MODO FOTO — opacidad plena,
    // redonda, pequeña: el avatar lejano visible como antes del Ciclo 2.
    const bub = p.bubble as HTMLDivElement | undefined;
    if (bub) {
      const va = mapVideoAlpha(dist);
      if (va <= 0.02) {
        // modo foto: burbuja redonda visible con la imagen del avatar;
        // feedback Tito: la foto necesita ~55% — video mínimo 50%, foto 55%
        bub.style.opacity = "1";
        const lFar = Math.max(l, 0.55);
        bub.style.transform = bub.style.transform.replace(/scale\([^)]*\)/, `scale(${lFar.toFixed(3)})`);
        if (p.video) p.video.style.display = "none";
        if (p.bubbleImg) p.bubbleImg.style.display = "block";
      } else {
        bub.style.opacity = String(va);
      }
      bub.style.transformOrigin = "center";
    }
    // Hablando (audioLevel RTP + fallback) — alimenta al halo
    if (isSpeaking(sc, id, now)) lastVoiceTs.set(id, now);
  }
  // Zonas: fade simétrico por proximidad (cerca = llena, lejos = tenue)
  for (const z of ((scene as any).grZones || []) as any[]) {
    const d = Math.hypot(z.grCx - me.worldX, z.grCy - me.worldY) / TILE;
    const target = d <= 6 ? z.grBaseAlpha : z.grBaseAlpha * 0.35;
    const cur = z.fillAlpha ?? z.grBaseAlpha;
    const next = cur + (target - cur) * 0.18; // ~250ms
    z.setFillStyle(z.fillColor, next);
  }
}

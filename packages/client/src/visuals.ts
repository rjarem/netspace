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
  const speakers: string[] = (globalThis as any).__grActiveSpeakers || [];
  const speakSet = new Set(speakers);
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
    const speaking = speakSet.has(id) || speakSet.has(String(p.handle || "").toLowerCase());
    const targetColor = speaking ? SPEAK_COLOR : roleColorOf(p);
    // pulso sutil al hablar
    const t = (globalThis as any).__grNow || Date.now();
    const pulse = speaking ? 1 + 0.12 * Math.sin(t / 160) : 1;
    p.roleHalo.radius = 19 * pulse;
    p.roleHalo.setPosition(p.worldX, p.worldY + 6);
    p.roleHalo.strokeColor = targetColor;
    // FADE: alpha objetivo (visible solo si rol ≠ normal o está hablando —
    // usuarios normales silenciosos: halo MUY sutil)
    const targetAlpha = speaking ? 0.95 : (targetColor !== ROLE_COLOR_DEFAULT ? 0.9 : 0.45);
    p.roleHalo.strokeAlpha = p.roleHalo.strokeAlpha == null ? 0 : p.roleHalo.strokeAlpha + (targetAlpha - p.roleHalo.strokeAlpha) * 0.12;
    // CAPA HTML (Tito, diagnóstico 17-sep): la burbuja de video/avatar es un
    // div HTML por ENCIMA del canvas — tapa el anillo Phaser. Pintar el rol
    // DIRECTO en la burbuja: borde del color del rol (+ glow verde al hablar).
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

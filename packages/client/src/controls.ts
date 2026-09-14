// Controls: drag & drop of own avatar + keyboard zoom (+/-).
// Extracted from main.ts (Tito's 250-400 line rule) — session 2026-09-13.
// Design decision (Tito + coder call): NO keyboard arrows, NO d-pad rosetta.
// Movement = click-to-move (existing) + drag of own avatar.
import Phaser from "phaser";
import { TILE, tileBlocked } from "./constants";

type SC = any; // WorldScene (loose to avoid circular imports)

const DRAG_SEND_MS = 100; // throttle: max 10 drag updates/s to Colyseus

/**
 * Wire drag-and-drop of the own avatar + +/- zoom keys.
 * Call from connect() after players can exist (idempotent: guards on this._controls).
 *
 * Drag model (agreed in design call):
 * - pointerdown ON own avatar bubble/sprite area → start drag (suppress click-to-move)
 * - while dragging: sprite follows finger locally (instant, no tween);
 *   send throttled tile moves (100ms) so others see the motion without saturating
 * - pointerup: final position = one last move; validation stays server-side
 * - the server still validates every tile step (walls/zones) — drag never bypasses it
 */
export function initControls(sc: SC) {
  if ((sc as any)._controlsInit) return;
  (sc as any)._controlsInit = true;

  const scene = sc as unknown as Phaser.Scene;

  // --- Zoom via +/- keys (laptops without wheel / touchscreens) ---
  window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "+" && e.key !== "=" && e.key !== "-" && e.key !== "_") return;
    const cam = scene.cameras.main;
    const cur = cam.zoom;
    const z = e.key === "+" || e.key === "="
      ? Phaser.Math.Clamp(cur + 0.2, 0.5, 2.5)
      : Phaser.Math.Clamp(cur - 0.2, 0.5, 2.5);
    cam.setZoom(z);
  });

  // --- Pinch-zoom táctil (móvil): 2 dedos = zoom, 1 dedo = drag normal ---
  // Fix (Tito, 14-sep): solo existía wheel (desktop) y teclas +/-; en el
  // teléfono no había forma de hacer zoom.
  const touches = new Map<number, { x: number; y: number }>();
  let lastPinchDist = 0;
  const PINCH_MIN_DIST = 24; // px: ignora dedos demasiado juntos
  const canvas = scene.game.canvas;
  // Flag compartido con la escena: 2+ dedos = pinch, no movimiento.
  const setPinching = (n: number) => {
    (scene as any).pinching = n >= 2;
    if (n >= 2) { (scene as any).target = null; (sc as any).target = null; (sc as any).dragging = false; }
  };
  const pinchDist = () => {
    const pts = [...touches.values()];
    return pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
  };
  canvas.addEventListener("touchstart", (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) touches.set(t.identifier, { x: t.clientX, y: t.clientY });
    setPinching(touches.size);
    if (touches.size === 2) { lastPinchDist = pinchDist(); }
  }, { passive: true });
  canvas.addEventListener("touchmove", (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      const prev = touches.get(t.identifier);
      if (prev) { prev.x = t.clientX; prev.y = t.clientY; }
    }
    if (touches.size >= 2) {
      e.preventDefault(); // el navegador no debe hacer zoom de página
      const d = pinchDist();
      if (lastPinchDist > PINCH_MIN_DIST && d > PINCH_MIN_DIST) {
        const cam = scene.cameras.main;
        const factor = d / lastPinchDist;
        cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, 0.5, 2.5));
      }
      lastPinchDist = d;
    }
  }, { passive: false });
  const endTouch = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) touches.delete(t.identifier);
    setPinching(touches.size);
    lastPinchDist = 0;
  };
  canvas.addEventListener("touchend", endTouch, { passive: true });
  canvas.addEventListener("touchcancel", endTouch, { passive: true });

  // --- Drag own avatar ---
  let dragging = false;
  let lastSend = 0;
  let dragStart = { x: 0, y: 0 };

  const isOnOwnAvatar = (pointer: Phaser.Input.Pointer): boolean => {
    const me = sc.players.get(sc.myId);
    if (!me) return false;
    // Generous hit area: sprite + label + bubble (screen-space check)
    const wx = pointer.worldX, wy = pointer.worldY;
    const dx = wx - me.sprite.x, dy = wy - me.sprite.y;
    const r = TILE * 1.6; // forgiving radius (bubbles are bigger than the sprite)
    return dx * dx + dy * dy <= r * r;
  };

  const sendTile = (wx: number, wy: number, force: boolean) => {
    const me = sc.players.get(sc.myId);
    if (!me || !sc.room) return;
    const tx = Math.floor(wx / TILE);
    const ty = Math.floor(wy / TILE);
    if (tileBlocked(tx, ty)) return; // client pre-check; server still validates
    const now = Date.now();
    if (!force && now - lastSend < DRAG_SEND_MS) return;
    lastSend = now;
    // Fix (Tito, 14-sep): 'barrera invisible' — si el drag supera DRAG_MAX_TILES
    // (8) el server RECHAZA el paquete en silencio, pero el cliente ya pintó la
    // posición nueva → onServerPosition hace snap-back violento. Clamp al tile
    // más lejano permitido dentro del radio, y NUNCA pintar más allá de eso.
    const fromTx = Math.round((me.worldX - TILE / 2) / TILE);
    const fromTy = Math.round((me.worldY - TILE / 2) / TILE);
    const ddx = tx - fromTx, ddy = ty - fromTy;
    const dist = Math.hypot(ddx, ddy);
    let sx = tx, sy = ty;
    if (dist > 8) {
      const k = 8 / dist;
      sx = fromTx + Math.round(ddx * k);
      sy = fromTy + Math.round(ddy * k);
      if (tileBlocked(sx, sy)) return; // el tile clampeado cae bloqueado: no pintar
    }
    sc.room.send("drag", { x: sx, y: sy });
    // Local instant follow (no tween fight — own tween not running during drag)
    const px = sx * TILE + TILE / 2, py = sy * TILE + TILE / 2;
    me.sprite.x = px; me.sprite.y = py;
    me.label.x = px; me.label.y = py - TILE * 0.85;
    const f = (me.sprite as any).faceRef;
    if (f) { f.x = px; f.y = py; }
    me.worldX = px; me.worldY = py;
  };

  scene.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
    if (isOnOwnAvatar(pointer)) {
      dragging = true;
      (sc as any).dragging = true; // visible para onServerPosition (no snap durante drag)
      sc.target = null; // cancel any click-to-move in progress
      dragStart = { x: pointer.worldX, y: pointer.worldY };
    }
  });

  scene.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
    if (!dragging || !pointer.isDown) { dragging = false; (sc as any).dragging = false; return; }
    sendTile(pointer.worldX, pointer.worldY, false);
  });

  scene.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
    if (!dragging) return;
    dragging = false;
    (sc as any).dragging = false;
    // Final position: force-send so the server ends exactly where the finger did
    sendTile(pointer.worldX, pointer.worldY, true);
    // Re-sync visual to the sent tile center (avoid half-tile offsets)
    const me = sc.players.get(sc.myId);
    if (me) {
      const tx = Math.floor(pointer.worldX / TILE);
      const ty = Math.floor(pointer.worldY / TILE);
      if (!tileBlocked(tx, ty)) {
        const wx = tx * TILE + TILE / 2, wy = ty * TILE + TILE / 2;
        me.sprite.x = wx; me.sprite.y = wy;
        me.label.x = wx; me.label.y = wy - TILE * 0.85;
        const f = (me.sprite as any).faceRef;
        if (f) { f.x = wx; f.y = wy; }
        me.worldX = wx; me.worldY = wy;
      }
    }
    void dragStart;
  });
}

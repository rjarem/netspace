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
    // During drag: teleport-style position updates (server validates + relays).
    // This bypasses the tile-by-tile walk — dragging is a direct reposition.
    sc.room.send("drag", { x: tx, y: ty });
    // Local instant follow (no tween fight — own tween not running during drag)
    me.sprite.x = wx; me.sprite.y = wy;
    me.label.x = wx; me.label.y = wy - TILE * 0.85;
    const f = (me.sprite as any).faceRef;
    if (f) { f.x = wx; f.y = wy; }
    me.worldX = wx; me.worldY = wy;
  };

  scene.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
    if (isOnOwnAvatar(pointer)) {
      dragging = true;
      sc.target = null; // cancel any click-to-move in progress
      dragStart = { x: pointer.worldX, y: pointer.worldY };
    }
  });

  scene.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
    if (!dragging || !pointer.isDown) { dragging = false; return; }
    sendTile(pointer.worldX, pointer.worldY, false);
  });

  scene.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
    if (!dragging) return;
    dragging = false;
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

// Shared constants, interfaces, and map helpers (extracted from main.ts — behavior unchanged).
import Phaser from "phaser";

export const TILE = 32;
export const APP_VERSION = "v23-sync-poll";
// Proximity radii (mirror shared constants — kept in sync manually)
export const AUDIO_RADIUS = 5;
export const AUDIO_MAX_RADIUS = 8;

// Client-side copy of restricted zones + walls (mirrors server world.ts).
// Attendee is the dev default role; zones list which roles may enter.
// Mirrors server world.ts (128x64). KEEP IN SYNC — better: fetch from server state in the future.
export const RESTRICTED_ZONES = [
  { x: 40, y: 3, w: 24, h: 10, allowed: ["admin", "speaker"] },             // Main Stage
  { x: 14, y: 30, w: 10, h: 8, allowed: ["admin", "speaker", "panelist"] }, // Round Table
  { x: 84, y: 8, w: 18, h: 12, allowed: ["admin", "speaker", "dj"] },       // DJ Lounge
];
export const WALLY = (x: number, y: number) =>
  y === 0 || y === 63 || x === 0 || x === 127 ||
  (x === 40 && y >= 8 && y < 18) || (x === 88 && y >= 34 && y < 48);

export function tileBlocked(x: number, y: number): boolean {
  if (WALLY(x, y)) return true;
  for (const z of RESTRICTED_ZONES) {
    if (x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) {
      if (!z.allowed.includes("attendee")) return true;
    }
  }
  return false;
}

// LiveKit audio-node registry: Web Audio gain+pan per remote identity (T2)
export interface AudioNode {
  ctx: AudioContext;
  gain: GainNode;
  panner: StereoPannerNode;
}

export interface PlayerUI {
  sprite: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  handle: string;
  worldX: number; // world px (tile center)
  worldY: number;
  bubble?: HTMLDivElement;   // video bubble overlay (T1)
  bubbleImg?: HTMLImageElement; // <img> del avatar dentro de la burbuja
  video?: HTMLVideoElement;
  audioEl?: HTMLAudioElement; // muted fallback element for remote audio
  audioNode?: AudioNode;      // Web Audio chain when available
  avatarColor: string;
  // Ciclo 2: escala visual por proximidad (solo presentación)
  visScale?: number;
}

export function drawZone(scene: Phaser.Scene, x: number, y: number, w: number, h: number, label: string, color: number, alpha: number) {
  const rect = scene.add.rectangle(
    x * TILE + (w * TILE) / 2, y * TILE + (h * TILE) / 2,
    w * TILE, h * TILE, color, alpha
  );
  rect.setStrokeStyle(2, color, 0.8);
  // Ciclo 2 (auditor): registrar zonas para fade por proximidad — solo
  // alpha visual, la lógica de zonas queda intacta.
  const zl = (scene as any).grZones as any[] || [];
  (rect as any).grBaseAlpha = alpha;
  (rect as any).grCx = rect.x; (rect as any).grCy = rect.y;
  zl.push(rect);
  (scene as any).grZones = zl;
  scene.add.text(
    x * TILE + (w * TILE) / 2, y * TILE + 4, label,
    { font: "11px system-ui", color: "#ffffffcc" }
  ).setOrigin(0.5, 0);
}

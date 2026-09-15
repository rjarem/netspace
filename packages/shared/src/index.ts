// NetSpace shared types — pure, no I/O. Both client and server import this.

export interface User {
  id: string;
  handle: string;
  role: UserRole;
  avatarStyle: string;
}

export type UserRole = "admin" | "speaker" | "attendee" | "panelist" | "dj";

export interface Position {
  x: number; // tile coordinates (float ok during interpolation)
  y: number;
}

export interface Zone {
  id: string;
  // Axis-aligned bounding box in tile coordinates (MVP: rect; F2: polygon)
  x: number;
  y: number;
  w: number;
  h: number;
  allowedRoles: UserRole[];
  mediaRef?: string;      // video/stream URL broadcast inside zone
  isStage: boolean;       // stage zones broadcast media to viewers
  label: string;
}

export interface WorldMap {
  name: string;
  w: number;      // tiles
  h: number;      // tiles
  walls: string[]; // "x,y" blocked tiles
  zones: Zone[];
}

// --- Proximity rules (server-authoritative) ---

export const AUDIO_RADIUS = 5;      // tiles: full-audio distance
export const AUDIO_MAX_RADIUS = 8;  // tiles: cutoff distance
export const VIDEO_GROUP_MAX = 4;   // max mutual avatars for P2P video

/** Is a tile inside a zone rect? */
export function inZone(p: Position, z: Zone): boolean {
  return p.x >= z.x && p.x < z.x + z.w && p.y >= z.y && p.y < z.y + z.h;
}

/** Can this user enter this zone? */
export function canEnter(p: Position, z: Zone, role: UserRole): boolean {
  return !inZone(p, z) || z.allowedRoles.includes(role);
}

/**
 * Movement validation — server side. Returns corrected position.
 * Blocks: walls and restricted zones (unless role allowed).
 * Clamps to map bounds.
 */
export function validateMove(
  from: Position,
  to: Position,
  map: WorldMap,
  role: UserRole
): Position {
  const x = Math.max(0, Math.min(map.w - 1, to.x));
  const y = Math.max(0, Math.min(map.h - 1, to.y));
  const snapped = { x: Math.floor(x), y: Math.floor(y) };

  if (map.walls.includes(`${snapped.x},${snapped.y}`)) return from;

  for (const z of map.zones) {
    if (inZone(snapped, z) && !z.allowedRoles.includes(role)) return from;
  }
  return { x, y };
}


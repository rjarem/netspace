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

/** Linear volume falloff 1.0 → 0.0 between AUDIO_RADIUS and AUDIO_MAX_RADIUS. */
export function proximityVolume(dist: number): number {
  if (dist <= AUDIO_RADIUS) return 1.0;
  if (dist >= AUDIO_MAX_RADIUS) return 0.0;
  return 1.0 - (dist - AUDIO_RADIUS) / (AUDIO_MAX_RADIUS - AUDIO_RADIUS);
}

export function tileDist(a: Position, b: Position): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

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

/**
 * Compute who hears/sees whom. Returns for each listener a map of
 * targetId → volume, plus nearest-video-group membership.
 */
export function computeProximity(
  players: Map<string, Position>,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const [aId, aPos] of players) {
    const m = new Map<string, number>();
    for (const [bId, bPos] of players) {
      if (aId === bId) continue;
      const v = proximityVolume(tileDist(aPos, bPos));
      if (v > 0) m.set(bId, v);
    }
    out.set(aId, m);
  }
  return out;
}
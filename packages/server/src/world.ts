// Default world map — neutral convention floor (128x64) [v3: bigger map]
// F2: themes replace this with themed layouts
import { WorldMap } from "@netspace/shared";

const W = 128, H = 64;
const walls: string[] = [];
// Border walls
for (let x = 0; x < W; x++) { walls.push(`${x},0`); walls.push(`${x},${H-1}`); }
for (let y = 0; y < H; y++) { walls.push(`0,${y}`); walls.push(`${W-1},${y}`); }
// Interior structure walls (meeting area dividers)
for (let y = 8; y < 18; y++) walls.push(`40,${y}`);
for (let y = 34; y < 48; y++) walls.push(`88,${y}`);

export const defaultMap: WorldMap = {
  name: "convention-floor",
  w: W,
  h: H,
  walls,
  zones: [
    {
      id: "main-stage",
      x: 40, y: 3, w: 24, h: 10,
      allowedRoles: ["admin", "speaker"],
      isStage: true,
      label: "Main Stage",
      mediaRef: "", // set per instance (DJ stream / video)
    },
    {
      id: "roundtable-1",
      x: 14, y: 30, w: 10, h: 8,
      allowedRoles: ["admin", "speaker", "panelist"],
      isStage: false,
      label: "Round Table 1",
      mediaRef: "",
    },
    {
      id: "lounge-dj",
      x: 84, y: 8, w: 18, h: 12,
      allowedRoles: ["admin", "speaker", "dj"],
      isStage: true,
      label: "DJ Lounge",
      mediaRef: "",
    },
  ],
};
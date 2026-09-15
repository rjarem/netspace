import { describe, it, expect } from "vitest";
import {
  inZone, canEnter, validateMove,
  type WorldMap,
} from "./index";

const map: WorldMap = {
  name: "test", w: 40, h: 30,
  walls: ["5,5", "5,6"],
  zones: [
    { id: "z1", x: 20, y: 10, w: 6, h: 4, allowedRoles: ["admin", "speaker"], isStage: true, label: "Stage", mediaRef: "https://x/v.mp4" },
  ],
};

// Nota (Fase 5a, auditor): proximityVolume, tileDist y computeProximity se
// ELIMINARON de shared — la reevaluación de proximidad vive en el cliente
// desde que broadcastProximity (O(N²) en el server) fue eliminado.

describe("zones", () => {
  it("inZone detection", () => {
    expect(inZone({ x: 21, y: 11 }, map.zones[0])).toBe(true);
    expect(inZone({ x: 19, y: 11 }, map.zones[0])).toBe(false);
  });
  it("attendee cannot enter stage, admin can", () => {
    expect(canEnter({ x: 19, y: 11 }, map.zones[0], "attendee")).toBe(true);
    expect(canEnter({ x: 21, y: 11 }, map.zones[0], "attendee")).toBe(false);
    expect(canEnter({ x: 21, y: 11 }, map.zones[0], "admin")).toBe(true);
  });
});

describe("validateMove", () => {
  it("blocks walls", () => {
    expect(validateMove({ x: 4, y: 5 }, { x: 5, y: 5 }, map, "admin")).toEqual({ x: 4, y: 5 });
  });
  it("blocks restricted zone for attendee", () => {
    expect(validateMove({ x: 19, y: 11 }, { x: 21, y: 11 }, map, "attendee")).toEqual({ x: 19, y: 11 });
  });
  it("allows restricted zone for speaker", () => {
    const r = validateMove({ x: 19, y: 11 }, { x: 21, y: 11 }, map, "speaker");
    expect(r.x).toBe(21);
  });
  it("clamps to bounds", () => {
    expect(validateMove({ x: 0, y: 0 }, { x: -5, y: 100 }, map, "admin")).toEqual({ x: 0, y: 29 });
  });
});

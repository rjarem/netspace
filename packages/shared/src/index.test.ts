import { describe, it, expect } from "vitest";
import {
  proximityVolume, tileDist, inZone, canEnter, validateMove, computeProximity,
  AUDIO_RADIUS, AUDIO_MAX_RADIUS, VIDEO_GROUP_MAX,
  type WorldMap, type Zone,
} from "./index";

const map: WorldMap = {
  name: "test", w: 40, h: 30,
  walls: ["5,5", "5,6"],
  zones: [
    { id: "z1", x: 20, y: 10, w: 6, h: 4, allowedRoles: ["admin", "speaker"], isStage: true, label: "Stage", mediaRef: "https://x/v.mp4" },
  ],
};

describe("proximityVolume", () => {
  it("full volume inside AUDIO_RADIUS", () => {
    expect(proximityVolume(0)).toBe(1.0);
    expect(proximityVolume(AUDIO_RADIUS)).toBe(1.0);
  });
  it("zero beyond max", () => {
    expect(proximityVolume(AUDIO_MAX_RADIUS)).toBe(0.0);
    expect(proximityVolume(20)).toBe(0.0);
  });
  it("linear falloff between", () => {
    expect(proximityVolume(AUDIO_RADIUS + 1)).toBeCloseTo(0.67, 1);
    expect(proximityVolume(AUDIO_MAX_RADIUS - 1)).toBeCloseTo(0.33, 1);
  });
});

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

describe("computeProximity", () => {
  it("close players hear each other, far ones don't", () => {
    const players = new Map([
      ["a", { x: 10, y: 10 }],
      ["b", { x: 12, y: 10 }],
      ["far", { x: 30, y: 30 }],
    ]);
    const prox = computeProximity(players);
    expect(prox.get("a")!.has("b")).toBe(true);
    expect(prox.get("a")!.has("far")).toBe(false);
    expect(prox.get("b")!.get("a")).toBe(1.0);
  });
});
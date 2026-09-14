// NetSpace World Room — server-authoritative state
import colyseus from "colyseus";
import type { Client } from "colyseus";
const { Server, Room, ServerError } = colyseus;
import { Schema, MapSchema, type } from "@colyseus/schema";
import {
  computeProximity, validateMove, inZone, canEnter,
  AUDIO_RADIUS, AUDIO_MAX_RADIUS, VIDEO_GROUP_MAX,
  type WorldMap, type UserRole, type Position,
} from "@netspace/shared";
import { defaultMap } from "./world.js";
import { mintLiveKitToken } from "./livekit.js";

// Drag & drop: max tiles per throttled drag update (anti-teleport guard).
// Client sends at most 10 updates/s while dragging — 8 tiles covers fast flicks.
const DRAG_MAX_TILES = 8;

class PlayerState extends Schema {
  @type("string") handle = "";
  @type("string") role: string = "attendee";
  @type("string") avatarStyle = "default";
  @type("float32") x = 2;
  @type("float32") y = 2;
  @type("boolean") micOn = false;
  @type("boolean") camOn = false;
  @type("boolean") inStage = false;
}

class WorldState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type("string") mapName = defaultMap.name;
  @type("string") theme = "corporate";
  @type("string") eventName = "NetSpace Demo";
}

// Message types
interface MoveMsg { x: number; y: number }
interface StateMsg { micOn?: boolean; camOn?: boolean }
interface JoinOpts {
  token: string; // signed JWT {handle, role}
}

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

// Minimal JWT verify (HS256) using Web Crypto — no external dep needed at runtime
async function verifyToken(token: string): Promise<{ handle: string; role: UserRole } | null> {
  try {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return null;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    const sig = Uint8Array.from(atobUrl(s), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify("HMAC", key, sig, enc.encode(`${h}.${p}`));
    if (!ok) return null;
    const payload = JSON.parse(atobUrl(p));
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return { handle: payload.handle, role: payload.role };
  } catch { return null; }
}
function atobUrl(s: string): string {
  return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
}

export class WorldRoom extends Room<WorldState> {
  maxClients = 150;
  map: WorldMap = defaultMap;
  liveKitHost: string = "";
  liveKitApiKey: string = "";
  liveKitApiSecret: string = "";

  onCreate(options: any) {
    this.setState(new WorldState());
    this.liveKitHost = process.env.LIVEKIT_HOST || "";
    this.liveKitApiKey = process.env.LIVEKIT_API_KEY || "";
    this.liveKitApiSecret = process.env.LIVEKIT_API_SECRET || "";

    // Proximity broadcast tick — 5 times/sec
    this.setSimulationInterval(() => this.broadcastProximity(), 200);

    this.onMessage("move", (client, msg: MoveMsg) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const from = { x: player.x, y: player.y };
      const to = validateMove(from, { x: msg.x, y: msg.y }, this.map, player.role as UserRole);
      player.x = to.x;
      player.y = to.y;
      this.updateZoneFlags(player);
      this.maybeRefreshLiveKitToken(client, player);
    });

    // Drag & drop of own avatar (v2 controls): direct reposition with the SAME
    // validation as move, but distance-capped to prevent teleport abuse.
    this.onMessage("drag", (client, msg: MoveMsg) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const from = { x: player.x, y: player.y };
      const dist = Math.hypot(msg.x - from.x, msg.y - from.y);
      if (dist > DRAG_MAX_TILES) return; // reject jumps — client sends throttled steps
      const to = validateMove(from, { x: msg.x, y: msg.y }, this.map, player.role as UserRole);
      player.x = to.x;
      player.y = to.y;
      this.updateZoneFlags(player);
    });

    this.onMessage("state", (client, msg: StateMsg) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (typeof msg.micOn === "boolean") player.micOn = msg.micOn;
      if (typeof msg.camOn === "boolean") player.camOn = msg.camOn;
    });
  }

  async onAuth(client: Client, options: JoinOpts) {
    // Dev mode: unauthenticated handle (base64 "dev:handle") — NO for production
    if (process.env.DEV_NO_AUTH === "1" && options.token?.startsWith("ZGV2")) {
      try {
        const handle = atob(options.token).split(":")[1] || "invitado";
        return { handle, role: "attendee" };
      } catch { /* fall through */ }
    }
    const claims = await verifyToken(options.token);
    if (!claims) throw new ServerError(401, "invalid token");
    return claims;
  }

  onJoin(client: Client, _options: any, auth?: { handle: string; role: UserRole }) {
    const player = new PlayerState();
    player.handle = auth?.handle ?? "invitado";
    player.role = (auth?.role ?? "attendee") as UserRole;
    player.avatarStyle = ["blue", "green", "orange", "purple"][this.clients.length % 4];
    // Spawn outside all restricted zones
    player.x = 4 + this.clients.length;
    player.y = 4;
    this.state.players.set(client.sessionId, player);
    // F2 voice: emit the first LiveKit token immediately on join (spawn zone),
    // otherwise attendees never cross a zone boundary and never receive one.
    this.maybeRefreshLiveKitToken(client, player);
    console.log(`[join] ${player.handle} (${player.role})`);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
  }

  updateZoneVisibility(player: PlayerState) {
    const p = { x: player.x, y: player.y };
    player.inStage = this.map.zones.some((z) => inZone(p, z) && z.isStage);
  }

  updateZoneFlags(player: PlayerState) {
    this.updateZoneVisibility(player);
  }

  /** Proximity volumes broadcast to every client 5x/sec. */
  broadcastProximity() {
    const positions = new Map<string, Position>();
    for (const [id, p] of this.state.players) {
      positions.set(id, { x: p.x, y: p.y });
    }
    const prox = computeProximity(positions);
    const payload: Record<string, Record<string, number>> = {};
    for (const [id, m] of prox) {
      const obj: Record<string, number> = {};
      for (const [t, v] of m) obj[t] = v;
      payload[id] = obj;
    }
    this.broadcast("proximity", payload);
  }

  /** Mint a LiveKit token when zone membership changes (audience ↔ stage). */
  lastZoneOf = new Map<string, string>();
  maybeRefreshLiveKitToken(client: Client, player: PlayerState) {
    const p = { x: player.x, y: player.y };
    const zoneId =
      this.map.zones.find((z) => inZone(p, z))?.id ?? "open-floor";
    if (this.lastZoneOf.get(client.sessionId) === zoneId) return;
    this.lastZoneOf.set(client.sessionId, zoneId);
    this.updateZoneVisibility(player);
    this.sendLiveKitToken(client, player, zoneId);
  }

  async sendLiveKitToken(client: Client, player: PlayerState, zoneId: string) {
    const zone = this.map.zones.find((z) => z.id === zoneId);
    // Networking concept: everyone can publish (mic + cam) while chatting.
    // Zone-based muting (stage areas = listen-only for audience) comes later;
    // for the MVP dev phase every participant gets publish rights.
    const canPublish = true;
    const token = await mintLiveKitToken({
      identity: client.sessionId,
      name: player.handle,
      canPublish: canPublish,
      canSubscribe: true,
    }, this.liveKitHost, this.liveKitApiKey, this.liveKitApiSecret);
    client.send("livekit", {
      token,
      url: this.liveKitHost,
      zoneId,
      isViewer: !canPublish,
      mediaRef: zone?.mediaRef || "",
    });
  }
}
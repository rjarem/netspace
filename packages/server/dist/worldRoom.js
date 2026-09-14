var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
// NetSpace World Room — server-authoritative state
import colyseus from "colyseus";
const { Server, Room, ServerError } = colyseus;
import { Schema, MapSchema, type } from "@colyseus/schema";
import { computeProximity, validateMove, inZone, } from "@netspace/shared";
import { defaultMap } from "./world.js";
import { mintLiveKitToken } from "./livekit.js";
// Drag & drop: max tiles per throttled drag update (anti-teleport guard).
// Client sends at most 10 updates/s while dragging — 8 tiles covers fast flicks.
const DRAG_MAX_TILES = 8;
class PlayerState extends Schema {
    constructor() {
        super(...arguments);
        this.handle = "";
        this.role = "attendee";
        this.avatarStyle = "default";
        this.x = 2;
        this.y = 2;
        this.micOn = false;
        this.camOn = false;
        this.inStage = false;
    }
}
__decorate([
    type("string")
], PlayerState.prototype, "handle", void 0);
__decorate([
    type("string")
], PlayerState.prototype, "role", void 0);
__decorate([
    type("string")
], PlayerState.prototype, "avatarStyle", void 0);
__decorate([
    type("float32")
], PlayerState.prototype, "x", void 0);
__decorate([
    type("float32")
], PlayerState.prototype, "y", void 0);
__decorate([
    type("boolean")
], PlayerState.prototype, "micOn", void 0);
__decorate([
    type("boolean")
], PlayerState.prototype, "camOn", void 0);
__decorate([
    type("boolean")
], PlayerState.prototype, "inStage", void 0);
class WorldState extends Schema {
    constructor() {
        super(...arguments);
        this.players = new MapSchema();
        this.mapName = defaultMap.name;
        this.theme = "corporate";
        this.eventName = "NetSpace Demo";
    }
}
__decorate([
    type({ map: PlayerState })
], WorldState.prototype, "players", void 0);
__decorate([
    type("string")
], WorldState.prototype, "mapName", void 0);
__decorate([
    type("string")
], WorldState.prototype, "theme", void 0);
__decorate([
    type("string")
], WorldState.prototype, "eventName", void 0);
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
// Minimal JWT verify (HS256) using Web Crypto — no external dep needed at runtime
async function verifyToken(token) {
    try {
        const [h, p, s] = token.split(".");
        if (!h || !p || !s)
            return null;
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey("raw", enc.encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
        const sig = Uint8Array.from(atobUrl(s), (c) => c.charCodeAt(0));
        const ok = await crypto.subtle.verify("HMAC", key, sig, enc.encode(`${h}.${p}`));
        if (!ok)
            return null;
        const payload = JSON.parse(atobUrl(p));
        if (payload.exp && payload.exp < Date.now() / 1000)
            return null;
        return { handle: payload.handle, role: payload.role };
    }
    catch {
        return null;
    }
}
function atobUrl(s) {
    return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
}
export class WorldRoom extends Room {
    constructor() {
        super(...arguments);
        this.maxClients = 150;
        this.map = defaultMap;
        this.liveKitHost = "";
        this.liveKitApiKey = "";
        this.liveKitApiSecret = "";
        /** Mint a LiveKit token when zone membership changes (audience ↔ stage). */
        this.lastZoneOf = new Map();
    }
    onCreate(options) {
        this.setState(new WorldState());
        this.liveKitHost = process.env.LIVEKIT_HOST || "";
        this.liveKitApiKey = process.env.LIVEKIT_API_KEY || "";
        this.liveKitApiSecret = process.env.LIVEKIT_API_SECRET || "";
        // Proximity broadcast tick — 5 times/sec
        this.setSimulationInterval(() => this.broadcastProximity(), 200);
        this.onMessage("move", (client, msg) => {
            const player = this.state.players.get(client.sessionId);
            if (!player)
                return;
            const from = { x: player.x, y: player.y };
            const to = validateMove(from, { x: msg.x, y: msg.y }, this.map, player.role);
            player.x = to.x;
            player.y = to.y;
            this.updateZoneFlags(player);
            this.maybeRefreshLiveKitToken(client, player);
        });
        // Drag & drop of own avatar (v2 controls): direct reposition with the SAME
        // validation as move, but distance-capped to prevent teleport abuse.
        this.onMessage("drag", (client, msg) => {
            const player = this.state.players.get(client.sessionId);
            if (!player)
                return;
            const from = { x: player.x, y: player.y };
            const dist = Math.hypot(msg.x - from.x, msg.y - from.y);
            if (dist > DRAG_MAX_TILES)
                return; // reject jumps — client sends throttled steps
            const to = validateMove(from, { x: msg.x, y: msg.y }, this.map, player.role);
            player.x = to.x;
            player.y = to.y;
            this.updateZoneFlags(player);
        });
        this.onMessage("state", (client, msg) => {
            const player = this.state.players.get(client.sessionId);
            if (!player)
                return;
            if (typeof msg.micOn === "boolean")
                player.micOn = msg.micOn;
            if (typeof msg.camOn === "boolean")
                player.camOn = msg.camOn;
        });
    }
    async onAuth(client, options) {
        // Dev mode: unauthenticated handle (base64 "dev:handle") — NO for production
        if (process.env.DEV_NO_AUTH === "1" && options.token?.startsWith("ZGV2")) {
            try {
                const handle = atob(options.token).split(":")[1] || "invitado";
                return { handle, role: "attendee" };
            }
            catch { /* fall through */ }
        }
        const claims = await verifyToken(options.token);
        if (!claims)
            throw new ServerError(401, "invalid token");
        return claims;
    }
    onJoin(client, _options, auth) {
        const player = new PlayerState();
        player.handle = auth?.handle ?? "invitado";
        player.role = (auth?.role ?? "attendee");
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
    onLeave(client) {
        this.state.players.delete(client.sessionId);
    }
    updateZoneVisibility(player) {
        const p = { x: player.x, y: player.y };
        player.inStage = this.map.zones.some((z) => inZone(p, z) && z.isStage);
    }
    updateZoneFlags(player) {
        this.updateZoneVisibility(player);
    }
    /** Proximity volumes broadcast to every client 5x/sec. */
    broadcastProximity() {
        const positions = new Map();
        for (const [id, p] of this.state.players) {
            positions.set(id, { x: p.x, y: p.y });
        }
        const prox = computeProximity(positions);
        const payload = {};
        for (const [id, m] of prox) {
            const obj = {};
            for (const [t, v] of m)
                obj[t] = v;
            payload[id] = obj;
        }
        this.broadcast("proximity", payload);
    }
    maybeRefreshLiveKitToken(client, player) {
        const p = { x: player.x, y: player.y };
        const zoneId = this.map.zones.find((z) => inZone(p, z))?.id ?? "open-floor";
        if (this.lastZoneOf.get(client.sessionId) === zoneId)
            return;
        this.lastZoneOf.set(client.sessionId, zoneId);
        this.updateZoneVisibility(player);
        this.sendLiveKitToken(client, player, zoneId);
    }
    async sendLiveKitToken(client, player, zoneId) {
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

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
import { validateMove, inZone, isModerationRole, } from "@netspace/shared";
import { defaultMap } from "./world.js";
import { mintLiveKitToken } from "./livekit.js";
import fs from "node:fs";
import path from "node:path";
// Drag & drop: max tiles per throttled drag update (anti-teleport guard).
// Client sends at most 10 updates/s while dragging — 8 tiles covers fast flicks.
const DRAG_MAX_TILES = 8;
class PlayerState extends Schema {
    constructor() {
        super(...arguments);
        this.handle = "";
        this.role = "attendee";
        this.avatarStyle = "default";
        // Fase 1.3 (auditoría): avatar dataURL FUERA del schema sincronizado — viaja
        // por mensaje separado "avatar" (broadcast). Schema budget: PlayerState <1KB.
        this.x = 2;
        this.y = 2;
        this.micOn = false;
        this.camOn = false;
        this.inStage = false;
        // Fase 6: moderación — identity del moderador que impuso el mute ("" = libre).
        // El server rechaza state micOn:true mientras esté activo (no reversible
        // desde el cliente).
        this.mutedBy = "";
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
__decorate([
    type("string")
], PlayerState.prototype, "mutedBy", void 0);
class WorldState extends Schema {
    constructor() {
        super(...arguments);
        this.serverBuild = ""; // Fase 0.3: build SHA anunciado server→client
        this.players = new MapSchema();
        this.mapName = defaultMap.name;
        this.theme = "corporate";
        this.eventName = "NetSpace Demo";
    }
}
__decorate([
    type("string")
], WorldState.prototype, "serverBuild", void 0);
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
// Fase 6: hash corto del token para invalidar re-joins de expulsados sin
// almacenar el JWT completo (djb2 hex — determinista, suficiente como key).
function hashToken(token) {
    let h = 5381;
    for (let i = 0; i < token.length; i++)
        h = ((h << 5) + h + token.charCodeAt(i)) >>> 0;
    return h.toString(16);
}
export class WorldRoom extends Room {
    constructor() {
        super(...arguments);
        this.maxClients = 150;
        this.map = defaultMap;
        this.liveKitHost = "";
        this.liveKitApiKey = "";
        this.liveKitApiSecret = "";
        // Fase 1.3: avatar photos fuera del schema — memoria server-side, sessionId → dataURL
        this.avatarPhotos = new Map();
        // Fase 6: moderación
        // - tokenHash → for SET en kickedTokens; el re-join con ese MISMO token es rechazado
        // - bannedHandles sobrevive restarts (archivo JSON); kicks viven en memoria
        this.bannedHandles = new Map();
        this.kickedTokens = new Set();
        this.tokenHashBySession = new Map();
        this.bansFile = path.resolve(process.env.BANS_FILE || "bans.json");
        // Fase 5a (escala): broadcastProximity() ELIMINADO — sin O(N²) cada 200ms.
        /** Mint a LiveKit token when zone membership changes (audience ↔ stage). */
        this.lastZoneOf = new Map();
    }
    onCreate(options) {
        this.setState(new WorldState());
        // Fase 0.3: self-identification — el server anuncia su build SHA en el state.
        // Env var BUILD_SHA la inyecta el Dockerfile/compose en el deploy.
        this.state.serverBuild = process.env.BUILD_SHA || "dev-unknown";
        console.log(`[build] serverBuild=${this.state.serverBuild} roomId=pre-create`);
        this.liveKitHost = process.env.LIVEKIT_HOST || "";
        this.liveKitApiKey = process.env.LIVEKIT_API_KEY || "";
        this.liveKitApiSecret = process.env.LIVEKIT_API_SECRET || "";
        // Fase 6: cargar baneos persistentes (sobreviven restarts)
        this.loadBans();
        // Proximity broadcast tick — 5 times/sec
        // Fase 5a (escala): broadcast "proximity" ELIMINADO — el cliente reevalúa
        // suscripciones de audio/video localmente (distancias por frame). Esto
        // quita O(N²) mensajes cada 200ms del server.
        // (Los tokens LiveKit ya se refrescan en onMove y onJoin — sin tick.)
        this.onMessage("move", (client, msg) => {
            const player = this.state.players.get(client.sessionId);
            if (!player)
                return;
            const from = { x: player.x, y: player.y };
            const to = validateMove(from, { x: msg.x, y: msg.y }, this.map, player.role);
            // Fase 5a (escala): cap anti-teleport también en "move" — un cliente
            // comprometido podía saltar cualquier distancia con un solo mensaje.
            const mdist = Math.hypot(to.x - from.x, to.y - from.y);
            if (mdist > DRAG_MAX_TILES)
                return; // move también es por pasos pequeños
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
            // Fase 6: mute impuesto NO reversible desde el cliente — el server
            // rechaza silenciosamente micOn:true mientras mutedBy esté activo.
            if (typeof msg.micOn === "boolean") {
                if (msg.micOn && player.mutedBy) {
                    client.send("mod-notice", { type: "mute-blocked", by: player.mutedBy });
                    return;
                }
                player.micOn = msg.micOn;
            }
            if (typeof msg.camOn === "boolean")
                player.camOn = msg.camOn;
        });
        // --- Fase 6: comandos de moderación (server-side, rol verificado del JWT
        // de sesión — client.auth ya fue validado en onAuth, el cliente NO manda
        // su rol, no hay forma de fingirlo) ---
        this.onMessage("mod:mute", (client, msg) => {
            const mod = this.state.players.get(client.sessionId);
            if (!mod || !isModerationRole(mod.role))
                return;
            const target = this.findByHandle(String(msg?.handle || ""));
            if (!target || target.handle === mod.handle)
                return;
            target.mutedBy = msg.on ? mod.handle : "";
            if (msg.on)
                target.micOn = false;
            this.broadcast("mod-notice", {
                type: "mute", target: target.handle, by: mod.handle, on: !!msg.on,
            });
            this.logMod(client, "mute", target.handle, String(msg?.on));
        });
        this.onMessage("mod:kick", (client, msg) => {
            const mod = this.state.players.get(client.sessionId);
            if (!mod || !isModerationRole(mod.role))
                return;
            this.kickByHandle(client, mod, String(msg?.handle || ""), "kick");
        });
        this.onMessage("mod:ban", (client, msg) => {
            const mod = this.state.players.get(client.sessionId);
            if (!mod || mod.role !== "admin")
                return; // ban/unban: SOLO admin
            if (msg?.unban) {
                this.bannedHandles.delete(String(msg.handle || ""));
                this.saveBans();
                this.broadcast("mod-notice", { type: "unban", target: msg.handle, by: mod.handle });
                this.logMod(client, "unban", String(msg?.handle || ""));
                return;
            }
            const handle = String(msg?.handle || "");
            if (!handle || handle === mod.handle)
                return;
            this.bannedHandles.set(handle, { by: mod.handle, ts: Date.now() });
            this.saveBans();
            this.broadcast("mod-notice", { type: "ban", target: handle, by: mod.handle });
            this.logMod(client, "ban", handle);
            this.kickByHandle(client, mod, handle, "ban");
        });
        // Fase 7: relay de emojis — broadcast a todos (los clientes los renderizan
        // flotando sobre el avatar emisor). Rate cap: 1 emoji/s por usuario.
        const lastEmojiAt = new Map();
        this.onMessage("emoji", (client, msg) => {
            const p = this.state.players.get(client.sessionId);
            if (!p)
                return;
            const now = Date.now();
            if (now - (lastEmojiAt.get(client.sessionId) || 0) < 1000)
                return;
            lastEmojiAt.set(client.sessionId, now);
            if (typeof msg?.emoji !== "string" || msg.emoji.length > 8)
                return;
            this.broadcast("emoji", { handle: p.handle, emoji: msg.emoji });
        });
        // Fase 2b: one-shot avatar photo upload at join. Capped at 60KB of dataURL
        // (client sends ~256px jpeg q0.82 ≈ 15-30KB) to keep the state payload sane.
        // Version handshake: clients ping "v2b" — only servers with the 2b build
        // (maxPayload fix + avatar relay) answer. Lets clients detect and leave
        // stale containers (orphans behind nginx round-robin) and rejoin healthy ones.
        this.onMessage("v2b", (client) => client.send("v2b", { ok: true }));
        this.onMessage("avatar", (client, msg) => {
            const player = this.state.players.get(client.sessionId);
            if (!player)
                return;
            // Fase 1.3: el avatar ya NO vive en el schema — se guarda en memoria y se
            // BROADCASTea a todos (los que ya están + los que lleguen vía onJoin).
            const photo = typeof msg?.photo === "string" ? msg.photo : "";
            if (photo.length > 1024) {
                console.warn(JSON.stringify({
                    ts: new Date().toISOString(), event: "avatar-oversize",
                    roomId: this.roomId, sessionId: client.sessionId,
                    sizeKB: +(photo.length / 1024).toFixed(1), build: this.state.serverBuild,
                }));
            }
            if (photo.startsWith("data:image/") && photo.length <= 60_000) {
                this.avatarPhotos.set(client.sessionId, photo);
                // Broadcast: a TODOS los clientes, incluyendo el propio (consistencia).
                this.broadcast("avatar", { sessionId: client.sessionId, photo });
                // Fase 2.2: ack explícito por mensaje (cliente reintenta exponencial).
                client.send("avatar-ok", { bytes: photo.length });
                console.log(`[avatar] ${player.handle} photo ${(photo.length / 1024).toFixed(1)}KB broadcast n=${this.clients.length}`);
            }
        });
    }
    async onAuth(client, options) {
        // Dev mode: unauthenticated handle (base64 "dev:handle") — NO for production
        if (process.env.DEV_NO_AUTH === "1" && options.token?.startsWith("ZGV2")) {
            try {
                const handle = atob(options.token).split(":")[1] || "invitado";
                return { handle, role: "attendee", isProbe: options.isProbe === true };
            }
            catch { /* fall through */ }
        }
        const tokenHash = hashToken(options.token || "");
        if (this.kickedTokens.has(tokenHash)) {
            throw new ServerError(403, "kicked");
        }
        const claims = await verifyToken(options.token);
        if (!claims)
            throw new ServerError(401, "invalid token");
        // Fase 6: handle baneado (persistente) → rechazo. El re-join con token
        // nuevo no evade el ban porque se banea por HANDLE, no por token.
        if (this.bannedHandles.has(claims.handle)) {
            throw new ServerError(403, "banned");
        }
        // Fase 5b (criterio 5, auditor): role fuera del enum → rechazado.
        const VALID_ROLES = ["admin", "moderator", "speaker", "attendee", "panelist", "dj"];
        if (!VALID_ROLES.includes(claims.role)) {
            throw new ServerError(401, "invalid role");
        }
        // recordar el hash del token para que mod:kick pueda invalidar el re-join
        this.tokenHashBySession.set(client.sessionId, tokenHash);
        // Fase 5b (criterio 9): isProbe viaja fuera del JWT (flag de sesión del
        // cliente probe), nunca otorga roles ni permisos — solo limita voz.
        return { ...claims, isProbe: options.isProbe === true };
    }
    // --- Fase 6 helpers de moderación ---
    findByHandle(handle) {
        for (const p of this.state.players.values()) {
            if ((p.handle || "").trim().toLowerCase() === handle.trim().toLowerCase())
                return p;
        }
        return undefined;
    }
    sessionsByHandle(handle) {
        const h = handle.trim().toLowerCase();
        const out = [];
        for (const c of this.clients) {
            const p = this.state.players.get(c.sessionId);
            if (p && (p.handle || "").trim().toLowerCase() === h)
                out.push(c);
        }
        return out;
    }
    kickByHandle(modClient, mod, handle, kind) {
        const targets = this.sessionsByHandle(handle);
        for (const c of targets) {
            const th = this.tokenHashBySession.get(c.sessionId);
            if (th)
                this.kickedTokens.add(th); // el MISMO token ya no vuelve a entrar
            try {
                c.send("kicked", { by: mod.handle, kind });
            }
            catch { /* */ }
            try {
                c.leave();
            }
            catch { /* */ }
            this.logMod(modClient, kind, handle);
        }
        this.broadcast("mod-notice", { type: kind, target: handle, by: mod.handle });
    }
    loadBans() {
        try {
            if (fs.existsSync(this.bansFile)) {
                const raw = JSON.parse(fs.readFileSync(this.bansFile, "utf8"));
                for (const [h, v] of Object.entries(raw || {})) {
                    this.bannedHandles.set(h, v);
                }
            }
        }
        catch (e) {
            console.warn("[bans] load failed:", e.message);
        }
    }
    saveBans() {
        try {
            fs.writeFileSync(this.bansFile, JSON.stringify(Object.fromEntries(this.bannedHandles), null, 2));
        }
        catch (e) {
            console.warn("[bans] save failed:", e.message);
        }
    }
    logMod(modClient, action, target, extra) {
        console.log(JSON.stringify({
            ts: new Date().toISOString(), event: "mod", action, target,
            by: this.state.players.get(modClient.sessionId)?.handle || "?",
            extra: extra || "", roomId: this.roomId, build: this.state.serverBuild,
        }));
    }
    onJoin(client, _options, auth) {
        const player = new PlayerState();
        player.handle = auth?.handle ?? "invitado";
        player.role = (auth?.role ?? "attendee");
        player.avatarStyle = ["blue", "green", "orange", "purple"][this.clients.length % 4];
        // Spawn outside all restricted zones. Fase 5a (escala): spawn con wrap —
        // cuando la fila llena el ancho útil, el siguiente usuario reaparece en
        // x=4 de una fila inferior (y+=4), nunca encima de otro ni en zona restringida.
        const n = this.clients.length;
        player.x = 4 + (n % 12);
        player.y = 4 + 4 * Math.floor(n / 12);
        if (player.y > this.map.h - 5) {
            player.y = 4;
            player.x = 4 + ((n + 5) % 12);
        }
        this.state.players.set(client.sessionId, player);
        // Fase 1.3: late-joiner recibe las fotos de TODOS los que ya están.
        for (const [sid, photo] of this.avatarPhotos) {
            client.send("avatar", { sessionId: sid, photo });
        }
        // F2 voice: emit the first LiveKit token immediately on join (spawn zone),
        // otherwise attendees never cross a zone boundary and never receive one.
        this.maybeRefreshLiveKitToken(client, player);
        // Fase 0.2: logging estructurado (auditoría) — JSON por evento.
        console.log(JSON.stringify({
            ts: new Date().toISOString(),
            event: "join",
            roomId: this.roomId,
            sessionId: client.sessionId,
            handle: player.handle,
            remoteAddr: client._remoteAddress || "unknown",
            build: this.state.serverBuild,
        }));
    }
    onLeave(client) {
        this.state.players.delete(client.sessionId);
        this.avatarPhotos.delete(client.sessionId); // Fase 1.3: no filtrar fotos de sesiones muertas
        this.tokenHashBySession.delete(client.sessionId); // Fase 6: limpiar mapa de sesión
        // Fase 0.2: logging estructurado
        console.log(JSON.stringify({
            ts: new Date().toISOString(),
            event: "leave",
            roomId: this.roomId,
            sessionId: client.sessionId,
            build: this.state.serverBuild,
        }));
    }
    updateZoneVisibility(player) {
        const p = { x: player.x, y: player.y };
        player.inStage = this.map.zones.some((z) => inZone(p, z) && z.isStage);
    }
    updateZoneFlags(player) {
        this.updateZoneVisibility(player);
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
        // Fase 5b (criterio 9, auditor): aislamiento de probes. Los clientes
        // headless (?probe=) obtienen token con canPublish:false +
        // canSubscribe:false — nunca aparecen como suscriptores de tracks
        // ajenos ni publican audio fantasma en la sala real. Los gates de
        // convergencia no necesitan audio.
        const isProbe = client.auth?.isProbe === true;
        const canPublish = !isProbe;
        const token = await mintLiveKitToken({
            identity: client.sessionId,
            name: player.handle,
            canPublish: canPublish,
            canSubscribe: !isProbe,
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

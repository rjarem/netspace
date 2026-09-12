import Phaser from "phaser";
import { Client, Room } from "colyseus.js";

const TILE = 32;
// Proximity radii (mirror shared constants — kept in sync manually)
const AUDIO_RADIUS = 5;
const AUDIO_MAX_RADIUS = 8;

// Client-side copy of restricted zones + walls (mirrors server world.ts).
// Attendee is the dev default role; zones list which roles may enter.
// Mirrors server world.ts (128x64). KEEP IN SYNC — better: fetch from server state in the future.
const RESTRICTED_ZONES = [
  { x: 40, y: 3, w: 24, h: 10, allowed: ["admin", "speaker"] },             // Main Stage
  { x: 14, y: 30, w: 10, h: 8, allowed: ["admin", "speaker", "panelist"] }, // Round Table
  { x: 84, y: 8, w: 18, h: 12, allowed: ["admin", "speaker", "dj"] },       // DJ Lounge
];
const WALLY = (x: number, y: number) =>
  y === 0 || y === 63 || x === 0 || x === 127 ||
  (x === 40 && y >= 8 && y < 18) || (x === 88 && y >= 34 && y < 48);

function tileBlocked(x: number, y: number): boolean {
  if (WALLY(x, y)) return true;
  for (const z of RESTRICTED_ZONES) {
    if (x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) {
      if (!z.allowed.includes("attendee")) return true;
    }
  }
  return false;
}

// LiveKit audio-node registry: Web Audio gain+pan per remote identity (T2)
interface AudioNode {
  ctx: AudioContext;
  gain: GainNode;
  panner: StereoPannerNode;
}
const audioNodes: Map<string, AudioNode> = new Map();

interface PlayerUI {
  sprite: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  handle: string;
  worldX: number; // world px (tile center)
  worldY: number;
  bubble?: HTMLDivElement;   // video bubble overlay (T1)
  video?: HTMLVideoElement;
  audioEl?: HTMLAudioElement; // muted fallback element for remote audio
  audioNode?: AudioNode;      // Web Audio chain when available
  avatarColor: string;
}

class WorldScene extends Phaser.Scene {
  room: Room<any> | null = null;
  myId = "";
  players: Map<string, PlayerUI> = new Map();
  cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  target: { x: number; y: number } | null = null;
  tickInterval: any = null;
  // T3: strict grid movement — one tile in flight at a time
  moveLock = false;
  movingTo: { x: number; y: number } | null = null;
  lockAt = 0;
  halo!: Phaser.GameObjects.Arc;

  constructor() { super("world"); }

  preload() {
    this.load.image("avatar-default", "avatar-default.png");
  }

  create() {
    const mapW = 128, mapH = 64;

    this.add.rectangle(mapW * TILE / 2, mapH * TILE / 2, mapW * TILE, mapH * TILE, 0x1c2130);

    const g = this.add.graphics();
    g.lineStyle(1, 0x232838, 1);
    for (let x = 0; x <= mapW; x++) g.lineBetween(x * TILE, 0, x * TILE, mapH * TILE);
    for (let y = 0; y <= mapH; y++) g.lineBetween(0, y * TILE, mapW * TILE, mapH * TILE);

    drawZone(this, 40, 3, 24, 10, "Main Stage", 0x7c4dff, 0.25);
    drawZone(this, 14, 30, 10, 8, "Round Table", 0x00bfa5, 0.25);
    drawZone(this, 84, 8, 18, 12, "DJ Lounge", 0xff5251, 0.25);

    // T1: halo = own proximity radius (audible/visible range)
    this.halo = this.add.circle(0, 0, AUDIO_MAX_RADIUS * TILE, 0x4f7cff, 0.05);
    this.halo.setStrokeStyle(2, 0x4f7cff, 0.35);

    this.cursors = this.input.keyboard!.createCursorKeys();

    // Robust keyboard input via DOM events (works even if canvas loses focus)
    const setKey = (e: KeyboardEvent, down: boolean) => {
      const k = e.key;
      const map: Record<string, string> = {
        ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
      };
      const dir = map[k];
      if (!dir) return;
      if (down) {
        // Exclusive: pressing a new arrow releases the previous one.
        this.keyState = { left: false, right: false, up: false, down: false, [dir]: true } as any;
      } else {
        (this.keyState as any)[dir] = false;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", (e) => setKey(e, true));
    window.addEventListener("keyup", (e) => setKey(e, false));
    this.input.keyboard!.disableGlobalCapture();
    window.addEventListener("blur", () => {
      this.keyState = { left: false, right: false, up: false, down: false };
    });

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.target = {
        x: Math.floor(pointer.worldX / TILE),
        y: Math.floor(pointer.worldY / TILE),
      };
    });
    this.cameras.main.setBounds(0, 0, mapW * TILE, mapH * TILE);
  }

  async connect(handle: string) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    // Production: Colyseus lives on api.turedvirtual.vip; dev: localhost:2567
    const server = location.port === "5173"
      ? "ws://localhost:2567"
      : `${proto}://api.${location.hostname.replace(/^play\./, "")}`;
    const client = new Client(server);
    try {
      const room = (await client.joinOrCreate("world", { token: btoa(`dev:${handle}`) })) as Room<any>;
      this.room = room;
      this.myId = room.sessionId;

      room.state.players.onAdd((player: any, id: string) => this.addPlayer(id, player));
      room.state.players.onRemove((_: any, id: string) => this.removePlayer(id));

      room.onMessage("proximity", (data: Record<string, Record<string, number>>) => {
        this.proximity = data[this.myId] || {};
        this.updateProximityVisuals();
        this.updateSubscriptions(); // T4: subscribe only to nearby video/audio
      });
      room.onMessage("livekit", (msg: any) => {
        console.log("[livekit]", msg.isViewer ? "viewer" : "publisher", msg.zoneId);
        this.pushDbg("livekit-msg:" + msg.zoneId + ":" + (msg.isViewer ? "viewer" : "pub"));
        this.joinVoice(msg);
      });

      // Minimap: corner canvas with dots (self highlighted). Scaled to map.
    const mm = document.createElement("canvas");
    mm.id = "minimap";
    mm.width = 160; mm.height = 80;
    const mmW = Math.min(160, Math.floor(window.innerWidth * 0.35));
mm.width = mmW; mm.height = Math.round(mmW / 2);
    mm.style.cssText = `position:fixed;right:8px;bottom:8px;width:${mmW}px;height:${Math.round(mmW/2)}px;background:#0b0e16cc;border:1px solid #2a3350;border-radius:8px;z-index:60;pointer-events:none;`;
    document.body.appendChild(mm);

    // Dynamic user list (thin window; groups by proximity clusters)
    const ul = document.createElement("div");
    ul.id = "userlist";
    ul.style.cssText = "position:fixed;right:8px;top:8px;width:auto;max-width:40vw;max-height:60vh;overflow-y:auto;background:#0b0e16cc;border:1px solid #2a3350;border-radius:10px;z-index:60;padding:5px;transition:width .2s;scrollbar-width:none;user-select:none;-webkit-user-select:none;touch-action:manipulation;-webkit-tap-highlight-color:transparent;";
    document.body.appendChild(ul);
    ul.addEventListener("click", (ev) => {
      // toggle expand only when clicking the container itself (not a pill row)
      if (ev.target === ul) ul.dataset.exp = ul.dataset.exp === "1" ? "0" : "1";
    });

    // PTZ-style d-pad (floating, mobile-first): tap arrows to step-move.
    const dp = document.createElement("div");
    dp.id = "dpad";
    dp.style.cssText = "position:fixed;left:12px;bottom:calc(18px + env(safe-area-inset-bottom, 0px));width:150px;height:150px;z-index:61;display:grid;grid-template-columns:repeat(3,50px);grid-template-rows:repeat(3,50px);gap:0;touch-action:none;user-select:none;-webkit-user-select:none;";
    const mkBtn = (label: string, dir: "up" | "down" | "left" | "right", gridArea: string) => {
      const btn = document.createElement("div");
      btn.textContent = label;
      btn.dataset.dir = dir;
      btn.style.cssText = `grid-area:${gridArea};display:flex;align-items:center;justify-content:center;font:24px system-ui;font-weight:bold;color:#111;background:#ffffff;border:2px solid #111;border-radius:12px;cursor:pointer;box-shadow:0 2px 6px #0008;`;
      dp.appendChild(btn);
    };
    mkBtn("\u2191", "up", "1 / 2");
    mkBtn("\u2190", "left", "2 / 1");
    mkBtn("\u2192", "right", "2 / 3");
    mkBtn("\u2193", "down", "3 / 2");
    document.body.appendChild(dp);
    dp.addEventListener("pointerdown", (ev) => {
      const t = (ev.target as HTMLElement).closest("[data-dir]") as HTMLElement | null;
      if (!t) return;
      ev.preventDefault();
      const dir = t.dataset.dir as "up" | "down" | "left" | "right";
      if (dir === "up") this.keyState.up = true;
      else if (dir === "down") this.keyState.down = true;
      else if (dir === "left") this.keyState.left = true;
      else if (dir === "right") this.keyState.right = true;
      // release shortly after — one step per tap (long-press = keep moving)
      clearTimeout((dp as any)._t);
      (dp as any)._t = setTimeout(() => {
        this.keyState.up = this.keyState.down = this.keyState.left = this.keyState.right = false;
      }, 260);
    });
    dp.addEventListener("pointerup", () => clearTimeout((dp as any)._hold));

    // Zoom with mouse wheel (desktop)
    this.input.on("wheel", (_p: unknown, _o: unknown, _d: unknown, dy: number) => {
      const cam = this.cameras.main;
      const z = Phaser.Math.Clamp(cam.zoom - dy * 0.001, 0.5, 2.5);
      cam.setZoom(z);
    });

    this.tickInterval = setInterval(() => this.tick(), 120);
      const st = document.getElementById("status");
      if (st) st.textContent = "✅ Conectado — click o flechas para moverte";
      // Debug handle for headless/server-side diagnostics
      (window as any).__ns = {
        scene: this,
        dbg: [] as string[],
      };
    } catch (e) {
      const st = document.getElementById("status");
      if (st) st.textContent = "❌ Error de conexión: " + (e as Error).message;
      console.error("join failed:", e);
    }
  }

  // ---- T3: strict tile movement ----

  /**
   * Server position change. For the LOCAL player this is the authoritative echo:
   * set position directly (no tween) and release the move lock when the tile we
   * sent has been reached. For remote players, tween smoothly.
   */
  onServerPosition(id: string, player: any) {
    const p = this.players.get(id);
    if (!p) return;
    const wx = player.x * TILE + TILE / 2;
    const wy = player.y * TILE + TILE / 2;
    if (id === this.myId) {
      // Server truth (rare for self — no echo). Snap only if far from sprite
      // (rejected move) to avoid fighting the optimistic animation.
      // Server truth ALWAYS wins for self: if the move was accepted this equals the
      // optimistic tween target (no visual change); if rejected, this corrects drift.
      p.worldX = wx; p.worldY = wy;
      this.tweens.killTweensOf([p.sprite, p.label, (p.sprite as any).faceRef].filter(Boolean));
      p.sprite.x = wx; p.sprite.y = wy;
      const f = (p.sprite as any).faceRef;
      if (f) { f.x = wx; f.y = wy; }
      p.label.x = wx; p.label.y = wy - TILE * 0.85;
      if (
        this.movingTo &&
        Math.round(player.x) === this.movingTo.x &&
        Math.round(player.y) === this.movingTo.y
      ) {
        this.moveLock = false;
        this.movingTo = null;
      }
    } else {
      p.worldX = wx; p.worldY = wy;
      this.tweens.add({
        targets: [p.sprite, p.label, (p.sprite as any).faceRef].filter(Boolean),
        x: wx, y: wy,
        duration: 110,
        onUpdate: () => { p.label.x = p.sprite.x; p.label.y = p.sprite.y - TILE * 0.85; },
      });
    }
  }

  tick() {
    if (!this.room) return;
    if (this.moveLock) {
      const meS = this.players.get(this.myId);
      if (meS && !this.tweens.isTweening(meS.sprite)) {
        // tween gone (rejected move / edge case): re-sync from stored tile and unlock
        meS.sprite.x = meS.worldX; meS.sprite.y = meS.worldY;
        this.moveLock = false; this.movingTo = null;
      }
    }
    if (this.moveLock) {
      // Hard watchdog: never allow a stuck lock to freeze navigation.
      if (Date.now() - (this.lockAt || 0) > 450) { this.moveLock = false; this.movingTo = null; }
      else return;
    }
    const me = this.players.get(this.myId);
    if (!me) return;

    // Current tile = integer tile the server last confirmed for me.
    const cur = {
      x: Math.round((me.worldX - TILE / 2) / TILE),
      y: Math.round((me.worldY - TILE / 2) / TILE),
    };

    let dir: { dx: number; dy: number } | null = null;
    const keysActive = this.keyState.left || this.keyState.right || this.keyState.up || this.keyState.down;
    if (keysActive && this.target) this.target = null; // keys override stale mouse target

    if (this.target) {
      const dx = Math.sign(this.target.x - cur.x);
      const dy = Math.sign(this.target.y - cur.y);
      if (dx !== 0 || dy !== 0) {
        if (dx !== 0 && dy !== 0 && !tileBlocked(cur.x + dx, cur.y + dy)) {
          // Prefer diagonal steps: walks a straight line toward the click point.
          dir = { dx, dy };
        } else if (dx !== 0 && !tileBlocked(cur.x + dx, cur.y)) {
          dir = { dx, dy: 0 };
        } else if (dy !== 0 && !tileBlocked(cur.x, cur.y + dy)) {
          dir = { dx: 0, dy };
        } else {
          this.target = null; // fully blocked; give up on this target
        }
      } else {
        this.target = null; // arrived
      }
    } else if (this.keyState.left) dir = { dx: -1, dy: 0 };
    else if (this.keyState.right) dir = { dx: 1, dy: 0 };
    else if (this.keyState.up) dir = { dx: 0, dy: -1 };
    else if (this.keyState.down) dir = { dx: 0, dy: 1 };
    else return;

    const nx = cur.x + dir!.dx, ny = cur.y + dir!.dy;
    if (tileBlocked(nx, ny)) return; // client-side pre-check; server still validates

    this.moveLock = true;
    this.lockAt = Date.now();
    this.movingTo = { x: nx, y: ny };
    this.room.send("move", { x: nx, y: ny });
    // Colyseus does NOT echo own-schema changes to the sender, so the server
    // onChange will NOT fire for us. Animate optimistically tile→tile and
    // unlock when the animation completes. If the server rejects the move
    // (wall/zone), our stored tile stays put and the next move re-syncs.
    this.animateOwnMove(nx, ny);
  }

  /** Smooth 120ms tile-to-tile animation for the local avatar, then unlock. */
  animateOwnMove(tx: number, ty: number) {
    const me = this.players.get(this.myId);
    if (!me) { this.moveLock = false; return; }
    const wx = tx * TILE + TILE / 2;
    const wy = ty * TILE + TILE / 2;
    this.tweens.add({
      targets: [me.sprite, me.label, (me.sprite as any).faceRef].filter(Boolean),
      x: wx, y: wy,
      duration: 120,
      ease: "Linear",
      onUpdate: () => {
        me.label.x = me.sprite.x; me.label.y = me.sprite.y - TILE * 0.85;
        const f = (me.sprite as any).faceRef;
        if (f) { f.x = me.sprite.x; f.y = me.sprite.y; }},
      onComplete: () => {
        me.worldX = wx; me.worldY = wy;
        this.moveLock = false;
        this.movingTo = null;
      },
    });
  }

  keyState: { left: boolean; right: boolean; up: boolean; down: boolean } = { left: false, right: false, up: false, down: false };
  proximity: Record<string, number> = {};

  /** Append to the window.__ns debug ring buffer (headless diagnostics). */
  pushDbg(s: string) {
    const ns = (window as any).__ns;
    if (ns) {
      ns.dbg.push(s);
      if (ns.dbg.length > 50) ns.dbg.shift();
    }
  }

  // ---- Voice (LiveKit) ----
  lkRoom: import("livekit-client").Room | null = null;
  lkZone = "";

  async joinVoice(msg: { token: string; url: string; zoneId: string; isViewer?: boolean }) {
    if (!msg.token || !msg.url) return;
    if (this.lkZone === msg.zoneId && this.lkRoom) return; // already in this zone
    this.lkZone = msg.zoneId;
    try {
      if (this.lkRoom) { await this.lkRoom.disconnect(); this.lkRoom = null; }
      const { Room, RoomEvent } = await import("livekit-client");
      const room = new Room({ adaptiveStream: true, dynacast: true });
      room.on(RoomEvent.TrackSubscribed, (track: any, pub: any, participant: any) => {
        if (track.kind === "audio") this.onRemoteAudio(participant.identity, track);
        else if (track.kind === "video") this.onRemoteVideo(participant.identity, track);
        this.updateVoiceStatus();
      });
      room.on(RoomEvent.TrackUnsubscribed, (track: any, pub: any, participant: any) => {
        if (track.kind === "video") this.removeRemoteVideo(participant.identity);
        this.updateVoiceStatus();
      });
      room.on(RoomEvent.LocalTrackPublished, (pub: any) => {
        if (pub.kind === "video") this.showLocalPreview(pub);
      });
      await room.connect(msg.url, msg.token);
      this.lkRoom = room;
      this.pushDbg("voice-ok:" + msg.zoneId);
      // If camera was already published (rejoin), attach now
      for (const pub of room.localParticipant.trackPublications.values()) {
        if (pub.kind === "video" && pub.track) this.showLocalPreview(pub);
      }
      // Already-subscribed tracks (e.g. on rejoin)
      for (const p of room.remoteParticipants.values()) {
        for (const pub of p.trackPublications.values()) {
          if (pub.isSubscribed && pub.track) {
            if (pub.track.kind === "audio") this.onRemoteAudio(p.identity, pub.track);
            else this.onRemoteVideo(p.identity, pub.track);
          }
        }
      }
      // Publish mic audio (browser will prompt for permission the first time)
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
        this.updateVoiceStatus();
      } catch (micErr) {
        console.warn("[voice] mic permission denied or unavailable:", micErr);
      }
      // Publish camera too (only allowed for non-viewer roles; harmless no-op otherwise)
      if (!msg.isViewer) {
        try {
          await room.localParticipant.setCameraEnabled(true);
          this.pushDbg("cam-ok:" + msg.zoneId);
        } catch (camErr) {
          console.warn("[voice] camera permission denied or unavailable:", camErr);
          this.pushDbg("cam-fail:" + (camErr as Error).message.slice(0, 120));
        }
      }
      console.log("[voice] connected to", msg.zoneId);
    } catch (e) {
      console.error("[voice] connect failed:", e);
      this.pushDbg("voice-fail:" + (e as Error).message.slice(0, 120));
    }
  }

  updateVoiceStatus() {
    const st = document.getElementById("status");
    if (!st) return;
    const n = this.lkRoom?.remoteParticipants.size ?? 0;
    const base = "✅ Conectado — click o flechas para moverte";
    st.textContent = n > 0 ? `${base} | 🎙️ ${n} en voz` : base;
  }

  // ---- T2: spatial audio via Web Audio API (gain + stereo pan) ----

  onRemoteAudio(identity: string, track: any) {
    const p = this.players.get(identity);
    if (!p) {
      // participant may not have a sprite yet; stash and retry on render loop
      setTimeout(() => this.onRemoteAudio(identity, track), 300);
      return;
    }
    // Web Audio chain: source → gain (distance falloff) → stereo panner → out.
    // The track is NOT attached to a playing element (double audio); instead we
    // mute-attach a hidden element to keep the MediaStream alive in some browsers.
    try {
      const ctx = new AudioContext();
      // Chrome/Safari create the context SUSPENDED until a user gesture — resume now
      // and also on the next pointer/keydown as a belt-and-braces.
      const resume = () => { if (ctx.state === "suspended") ctx.resume().catch(() => {}); };
      resume();
      window.addEventListener("pointerdown", resume, { once: true });
      window.addEventListener("keydown", resume, { once: true });
      // Keep the MediaStream alive: muted hidden element (Chrome mutes WebAudio-only streams
      // in some versions when no element is attached).
      const keepAlive = document.createElement("audio");
      keepAlive.muted = true;
      keepAlive.autoplay = true;
      document.body.appendChild(keepAlive);
      try { track.attach(keepAlive); } catch { /* attach optional */ }
      const source = ctx.createMediaStreamSource(track.mediaStream);
      const gain = ctx.createGain();
      const panner = ctx.createStereoPanner();
      source.connect(gain).connect(panner).connect(ctx.destination);
      p.audioNode = { ctx, gain, panner };
      p.audioEl = keepAlive; // cleaned up in removePlayer
    } catch (err) {
      console.warn("[audio] WebAudio failed, falling back to element:", err);
      const a = document.createElement("audio");
      a.autoplay = true;
      document.body.appendChild(a);
      track.attach(a);
      p.audioEl = a;
    }
    this.pushDbg("audio-remote:" + identity);
  }

  /** Per-frame spatial audio: update gain/pan from avatar distances. */
  private subThrottle = 0;
  updateSpatialAudio() {
    // Re-evaluate proximity subscriptions periodically (players move!)
    if (Date.now() - this.subThrottle > 500) {
      this.subThrottle = Date.now();
      try { this.updateSubscriptions(); } catch { /* room not ready */ }
    }
    const me = this.players.get(this.myId);
    if (!me) return;
    for (const [id, p] of this.players) {
      if (id === this.myId) continue;
      const dist = Phaser.Math.Distance.Between(me.worldX, me.worldY, p.worldX, p.worldY) / TILE;
      const vol = dist <= AUDIO_RADIUS ? 1.0
        : dist >= AUDIO_MAX_RADIUS ? 0.0
        : 1.0 - (dist - AUDIO_RADIUS) / (AUDIO_MAX_RADIUS - AUDIO_RADIUS);
      // Stereo pan: normalized horizontal offset (±1 at the pan range)
      const dx = (p.worldX - me.worldX) / (AUDIO_MAX_RADIUS * TILE);
      const pan = Math.max(-1, Math.min(1, dx));
      if (p.audioNode) {
        p.audioNode.gain.gain.value = vol;
        p.audioNode.panner.pan.value = pan;
      } else if (p.audioEl) {
        (p.audioEl as any).volume = vol;
      }
      // Sprite ring brightness tracks audible proximity too
      p.sprite.setStrokeStyle(Math.round(vol * 3), 0xffffff, Math.min(1, vol * 1.5));
    }
  }

  renderMinimap() {
    const mm = document.getElementById("minimap") as HTMLCanvasElement | null;
    if (!mm) return;
    const ctx = mm.getContext("2d");
    if (!ctx) return;
    const mw = mm.width, mh = mm.height;
    ctx.clearRect(0, 0, mw, mh);
    // map is mapW x mapH tiles
    const mapW = 128, mapH = 64;
    const sx = mw / mapW, sy = mh / mapH;
    // zones
    ctx.fillStyle = "#7c4dff44"; ctx.fillRect(40 * sx, 3 * sy, 24 * sx, 10 * sy);
    ctx.fillStyle = "#00bfa544"; ctx.fillRect(14 * sx, 30 * sy, 10 * sx, 8 * sy);
    ctx.fillStyle = "#ff525144"; ctx.fillRect(84 * sx, 8 * sy, 18 * sx, 12 * sy);
    for (const [id, p] of this.players) {
      const me = id === this.myId;
      ctx.fillStyle = me ? "#ffffff" : (p.avatarColor || "#4f7cff");
      ctx.beginPath();
      ctx.arc(p.worldX / TILE * sx, p.worldY / TILE * sy, me ? 3.2 : 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  renderUserList() {
    const ul = document.getElementById("userlist");
    if (!ul) return;
    const me = this.players.get(this.myId);
    // throttle DOM rebuild to 1/s
    if (this.ulLast && Date.now() - this.ulLast < 1000) return;
    this.ulLast = Date.now();
    ul.innerHTML = "";
    // group players: cluster by AUDIO_MAX_RADIUS adjacency (BFS over close pairs)
    const ids = [...this.players.keys()].filter((i) => i !== this.myId);
    const groups: string[][] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) continue;
      const grp = [id]; seen.add(id);
      for (let k = 0; k < grp.length; k++) {
        const a = this.players.get(grp[k])!;
        for (const b of ids) {
          if (seen.has(b)) continue;
          const bb = this.players.get(b)!;
          if (Phaser.Math.Distance.Between(a.worldX, a.worldY, bb.worldX, bb.worldY) <= AUDIO_MAX_RADIUS * TILE) {
            grp.push(b); seen.add(b);
          }
        }
      }
      groups.push(grp);
    }
    // my group first
    const myGroup = me ? groups.find((g) => g.some((id) => {
      const p = this.players.get(id)!;
      return Phaser.Math.Distance.Between(me.worldX, me.worldY, p.worldX, p.worldY) <= AUDIO_MAX_RADIUS * TILE;
    })) : undefined;
    groups.sort((g1, g2) => (g2 === myGroup ? 1 : 0) - (g1 === myGroup ? 1 : 0));
    // render: thin by default (initials avatars); expand on hover/click
    const expanded = ul.dataset.exp === "1";
    const mk = (id: string, isMeRow: boolean) => {
      const p = this.players.get(id)!;
      const row = document.createElement("div");
      row.title = p.handle || id;
      row.style.cssText = "display:flex;align-items:center;gap:6px;padding:4px;cursor:pointer;border-radius:8px;user-select:none;-webkit-user-select:none;touch-action:manipulation;-webkit-tap-highlight-color:transparent;";
      row.addEventListener("pointerdown", (e) => e.preventDefault());
      // Pill button with the handle (first word, max 8 chars) — much more intuitive than initials
      const full = (p.handle || id).trim();
      const short = (full.split(/\s+/)[0] || full).slice(0, 8);
      const dot = document.createElement("span");
      dot.style.cssText = `min-width:26px;height:26px;padding:0 8px;border-radius:13px;background:${p.avatarColor};flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;font:bold 12px system-ui;color:#fff;box-shadow:0 1px 4px #0007;white-space:nowrap;`;
      dot.textContent = short;
      row.appendChild(dot);
      if (expanded) {
        const nm = document.createElement("span");
        nm.style.cssText = "font:11px system-ui;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        nm.textContent = (p.handle || id) + (isMeRow ? " (yo)" : "");
        row.appendChild(nm);
      }
      row.onclick = () => {
        const cam = this.cameras.main;
        cam.stopFollow();
        cam.pan(p.sprite.x, p.sprite.y, 400, "Sine", true, () => {
          const me2 = this.players.get(this.myId);
          if (me2) cam.startFollow(me2.sprite, true, 0.1, 0.1);
        });
      };
      ul.appendChild(row);
    };
    if (me) mk(this.myId, true);
    for (const g of groups) {
      if (expanded && groups.length > 0) {
        const sep = document.createElement("div");
        sep.style.cssText = "height:1px;background:#2a3350;margin:4px 2px;";
        ul.appendChild(sep);
      }
      for (const id of g) mk(id, false);
    }
  }
  ulLast = 0;

  // ---- T1: video bubbles over avatars ----

  /** Fullscreen overlay layer that tracks Phaser world coordinates. */
  bubbleLayer(): HTMLElement {
    let layer = document.getElementById("bubbleLayer") as HTMLElement | null;
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "bubbleLayer";
      layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:900;overflow:hidden;";
      document.body.appendChild(layer);
    }
    return layer;
  }

  onRemoteVideo(identity: string, track: any) {
    const p = this.players.get(identity);
    if (!p) {
      setTimeout(() => this.onRemoteVideo(identity, track), 300);
      return;
    }
    this.ensureBubble(p, identity);
    if (typeof track.attach === "function" && p.video) {
      track.attach(p.video);
      p.video.play().catch(() => {});
      const av = p.bubble?.querySelector("img"); if (av) av.style.display = "none";
    }
    this.pushDbg("video-remote:" + identity);
  }

  removeRemoteVideo(identity: string) {
    const p = this.players.get(identity);
    if (p?.bubble && p.video) {
      // keep the bubble (avatar), just clear the video stream
      p.video.srcObject = null;
      p.video.style.display = "none";
      p.bubble.dataset.hasVideo = "0";
      const av = p.bubble.querySelector("img"); if (av) av.style.display = "block";
    }
  }

  ensureBubble(p: PlayerUI, identity: string) {
    if (p.bubble) return p.bubble;
    const isMe = identity === this.myId || this.players.get(this.myId) === p;
    const b = document.createElement("div");
    b.style.cssText = [
      "position:absolute", "width:84px", "height:84px", "border-radius:50%",
      "overflow:hidden", "background:#1a1a1e",
      "border:3px solid " + (isMe ? "#ffffff" : "#4f7cff"),
      "box-shadow:0 2px 8px #0009", "transform:translate(-50%,-50%)",
    ].join(";");
    b.dataset.hasVideo = "0";
    // Default avatar image shown when the participant is NOT streaming video
    const av = document.createElement("img");
    av.src = "avatar-default.png";
    av.alt = "";
    av.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
    b.appendChild(av);
    const v = document.createElement("video");
    v.style.cssText = "width:100%;height:100%;object-fit:cover;" + (isMe ? "transform:scaleX(-1);" : "");
    v.autoplay = true; v.playsInline = true;
    if (isMe) v.muted = true;
    v.style.display = "none";
    b.appendChild(v);
    // Name tag under the bubble
    const name = document.createElement("div");
    name.style.cssText = "position:absolute;bottom:-2px;left:50%;transform:translateX(-50%);font:11px system-ui;color:#fff;background:#000000aa;padding:1px 6px;border-radius:4px;white-space:nowrap;";
    name.textContent = (p.handle || identity).slice(0, 14);
    b.appendChild(name);
    this.bubbleLayer().appendChild(b);
    p.bubble = b;
    p.video = v;
    return b;
  }

  /** Attach the local camera track to MY bubble (replaces old corner preview). */
  showLocalPreview(pubOrTrack: any) {
    const track = pubOrTrack?.track ?? pubOrTrack;
    if (typeof track?.attach !== "function") return;
    const me = this.players.get(this.myId);
    if (!me) { setTimeout(() => this.showLocalPreview(pubOrTrack), 300); return; }
    const b = this.ensureBubble(me, this.myId);
    const nameTag = b.querySelector("div") as HTMLElement;
    if (nameTag) nameTag.textContent = "Tú";
    if (me.video) {
      track.attach(me.video);
      me.video.style.display = "";
      me.video.play().catch(() => {});
      b.dataset.hasVideo = "1";
      const av = b.querySelector("img"); if (av) av.style.display = "none";
    }
    this.pushDbg("video-self");
  }

  /** Per-frame: position bubbles in screen space from Phaser world coords. */
  updateBubbles() {
    const cam = this.cameras.main;
    const zoom = cam.zoom;
    for (const p of this.players.values()) {
      if (!p.bubble) continue;
      const sx = (p.sprite.x - cam.scrollX) * zoom;
      const sy = (p.sprite.y - cam.scrollY) * zoom;
      p.bubble.style.transform = `translate3d(${sx - 42}px,${sy - 42}px,0)`;
      // video visible only when actually streaming
      if (p.video && p.video.srcObject) p.video.style.display = "";
      else if (p.video) p.video.style.display = "none";
    }
  }

  // ---- T4: subscribe only to nearby participants ----

  updateSubscriptions() {
    if (!this.lkRoom) return;
    const me = this.players.get(this.myId);
    if (!me) return;
    for (const p of this.lkRoom.remoteParticipants.values()) {
      const sprite = this.players.get(p.identity);
      if (!sprite) continue;
      const dist = Phaser.Math.Distance.Between(me.worldX, me.worldY, sprite.worldX, sprite.worldY) / TILE;
      const want = dist <= AUDIO_MAX_RADIUS;
      for (const pub of p.trackPublications.values()) {
        if (pub.isSubscribed !== want) {
          try { pub.setSubscribed(want); } catch { /* already in desired state */ }
        }
      }
    }
  }

  // ---- players ----

  addPlayer(id: string, player: any) {
    if (this.players.has(id)) return;
    const colors: Record<string, number> = {
      blue: 0x4f7cff, green: 0x00c853, orange: 0xff9100, purple: 0xaa00ff,
    };
    const color = colors[player.avatarStyle] || 0x4f7cff;
    const colorHex = "#" + color.toString(16).padStart(6, "0");
    const isMe = id === this.myId;
    const wx = player.x * TILE + TILE / 2;
    const wy = player.y * TILE + TILE / 2;
    const sprite = this.add.rectangle(wx, wy, TILE * 0.7, TILE * 0.7, color, 1);
    // Generic avatar placeholder: PNG served from the client assets
    // (/avatar-default.png) until photo-avatars (camera snapshot at signup) land.
    const face = this.add.image(wx, wy, "avatar-default").setDisplaySize(TILE * 0.62, TILE * 0.62);
    (sprite as any).faceRef = face;
    sprite.once(Phaser.GameObjects.Events.DESTROY, () => face.destroy());
    if (isMe) {
      sprite.setStrokeStyle(3, 0xffffff, 1);
      this.cameras.main.startFollow(sprite, true, 0.1, 0.1);
    }
    const label = this.add.text(
      wx, wy - TILE * 0.85, player.handle + (isMe ? " (yo)" : ""),
      { font: "12px system-ui", color: "#fff", backgroundColor: "#00000088", padding: { x: 4, y: 2 } }
    ).setOrigin(0.5);
    const ui: PlayerUI = { sprite, label, handle: player.handle, worldX: wx, worldY: wy, avatarColor: colorHex };
    this.players.set(id, ui);
    // Schema 2.x: the players-map onChange does NOT fire on field updates —
    // per-player instance onChange is the reliable per-tick position signal.
    if (player.onChange) {
      player.onChange(() => {
        const cur = this.players.get(id);
        if (cur) this.onPlayerInstanceChange(id, player);
      });
    }
    if (isMe) {
      // My bubble: colored circle immediately; video attaches when cam publishes
      this.ensureBubble(ui, id);
    }
  }

  /** Per-field update for any player (fires for BOTH self and remotes in schema 2.x). */
  onPlayerInstanceChange(id: string, player: any) {
    // Position handled here; skip for self (optimistic tween owns the sprite)
    if (id !== this.myId) this.onServerPosition(id, player);
    // handle/avatar-style changes would also land here
  }

  removePlayer(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    p.sprite.destroy(); p.label.destroy();
    p.bubble?.remove();
    if (p.audioNode) { try { p.audioNode.ctx.close(); } catch {} }
    p.audioEl?.remove();
    this.players.delete(id);
  }

  updateProximityVisuals() {
    // now handled in updateSpatialAudio (per-frame, continuous)
  }

  update() {
    if (this.players.size === 0) return;
    const me = this.players.get(this.myId);
    if (me) {
      this.halo.setPosition(me.worldX, me.worldY);
    }
    this.updateBubbles();
    this.updateSpatialAudio();
    try { this.renderMinimap(); } catch (e) { console.warn("[minimap]", e); }
    try { this.renderUserList(); } catch (e) { console.warn("[userlist]", e); }
  }
}

function drawZone(scene: WorldScene, x: number, y: number, w: number, h: number, label: string, color: number, alpha: number) {
  const rect = scene.add.rectangle(
    x * TILE + (w * TILE) / 2, y * TILE + (h * TILE) / 2,
    w * TILE, h * TILE, color, alpha
  );
  rect.setStrokeStyle(2, color, 0.8);
  scene.add.text(
    x * TILE + (w * TILE) / 2, y * TILE + 4, label,
    { font: "11px system-ui", color: "#ffffffcc" }
  ).setOrigin(0.5, 0);
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: "#0f1117",
  scale: { mode: Phaser.Scale.RESIZE },
  scene: [WorldScene],
});

(document.getElementById("go") as HTMLButtonElement).onclick = () => {
  const input = document.getElementById("handle") as HTMLInputElement;
  const handle = (input.value || "invitado-" + Math.floor(Math.random() * 999)).trim();
  (document.getElementById("join") as HTMLElement).style.display = "none";
  const scene = game.scene.scenes[0] as WorldScene;
  scene.connect(handle);
};

(document.getElementById("handle") as HTMLInputElement).addEventListener("keydown", (e) => {
  if (e.key === "Enter") (document.getElementById("go") as HTMLButtonElement).click();
});

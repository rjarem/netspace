import Phaser from "phaser";
import { Client, Room } from "colyseus.js";
import {
  TILE, APP_VERSION, AUDIO_RADIUS, AUDIO_MAX_RADIUS,
  tileBlocked, drawZone, PlayerUI,
} from "./constants";
import { joinVoice, updateVoiceStatus, onRemoteAudio, updateSpatialAudio, updateSubscriptions } from "./voice";
import { onRemoteVideo, removeRemoteVideo, ensureBubble, showLocalPreview, updateBubbles } from "./bubbles";
import { renderMinimap, renderUserList } from "./hud";
import { onServerPosition, tick, animateOwnMove } from "./movement";
import { initControls } from "./controls";
import { runGreenRoom, type GreenRoomResult } from "./greenroom";

/**
 * WorldScene — orchestrator. Method bodies live in voice.ts / bubbles.ts / hud.ts /
 * movement.ts (Tito's 250-400 line rule). Each stub delegates with `this` so call
 * sites, timing, and behavior stay identical to the pre-refactor app.
 */
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
  keyState: { left: boolean; right: boolean; up: boolean; down: boolean } = { left: false, right: false, up: false, down: false }; // DEPRECATED v2 — kept for type compat, never set
  proximity: Record<string, number> = {};
  private subThrottle = 0;
  ulLast = 0;
  pollT = 0;
  lkRoom: import("livekit-client").Room | null = null;
  lkZone = "";

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

    // v2 controls: NO keyboard arrows, NO d-pad rosetta (decision 13-sep).
    // Movement = click-to-move (pointerdown below) + drag of own avatar.
    // Keyboard is reserved for zoom (+/-) — see controls.ts.
    initControls(this);

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
      // Fase 2b: relay my Antesala photo to everyone (one-shot, server-capped 60KB)
      const myPhoto = (window as any).__greenroom?.avatarPhoto;
      if (myPhoto) room.send("avatar", { photo: myPhoto });

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

    // d-pad rosetta REMOVED (v2 controls, decision 13-sep): was stealing screen
    // space on mobile; drag & click-to-move replace it entirely.

    // Zoom with mouse wheel (desktop)
    this.input.on("wheel", (_p: unknown, _o: unknown, _d: unknown, dy: number) => {
      const cam = this.cameras.main;
      const z = Phaser.Math.Clamp(cam.zoom - dy * 0.001, 0.5, 2.5);
      cam.setZoom(z);
    });

    this.tickInterval = setInterval(() => this.tick(), 120);
      const st = document.getElementById("status");
      if (st) st.textContent = "✅ " + APP_VERSION + " — conectado";
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


  // ---- T3: strict tile movement (bodies in movement.ts) ----
  onServerPosition(id: string, player: any) { onServerPosition(this, id, player); }
  tick() { tick(this); }
  animateOwnMove(tx: number, ty: number) { animateOwnMove(this, tx, ty); }

  /** Append to the window.__ns debug ring buffer (headless diagnostics). */
  pushDbg(s: string) {
    const ns = (window as any).__ns;
    if (ns) {
      ns.dbg.push(s);
      if (ns.dbg.length > 50) ns.dbg.shift();
    }
  }


  // ---- Voice (LiveKit) — bodies in voice.ts ----
  async joinVoice(msg: { token: string; url: string; zoneId: string; isViewer?: boolean }) { await joinVoice(this, msg); }
  updateVoiceStatus() { updateVoiceStatus(this); }
  onRemoteAudio(identity: string, track: any) { onRemoteAudio(this, identity, track); }
  updateSpatialAudio() { updateSpatialAudio(this); }
  updateSubscriptions() { updateSubscriptions(this); }

  // ---- Video bubbles — bodies in bubbles.ts ----
  onRemoteVideo(identity: string, track: any) { onRemoteVideo(this, identity, track); }
  removeRemoteVideo(identity: string) { removeRemoteVideo(this, identity); }
  ensureBubble(p: PlayerUI, identity: string) { return ensureBubble(this, p, identity); }
  showLocalPreview(pubOrTrack: any) { showLocalPreview(this, pubOrTrack); }
  updateBubbles() { updateBubbles(this); }

  // ---- HUD — bodies in hud.ts ----
  renderMinimap() { renderMinimap(this); }
  renderUserList() { renderUserList(this); }

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
    // Avatar: photo from Antesala — self uses local copy, others from relayed state.
    let face: Phaser.GameObjects.Image = this.add.image(wx, wy, "avatar-default").setDisplaySize(TILE * 0.62, TILE * 0.62);
    // Fase 2b: everyone's avatar shows their Antesala photo (relayed via state).
    // For SELF prefer the local copy (instant); others come from player.avatarPhoto.
    const photoData = (isMe && (window as any).__greenroom?.avatarPhoto) || player.avatarPhoto || "";
    if (photoData) {
      const texKey = "avatar-photo-" + id;
      // Load via Image element first; only touch Phaser when fully decoded.
      // (textures.addBase64 events race with scene creation — Tito saw the
      // default avatar persist. This removes all event-order assumptions.)
      const img = new Image();
      img.onload = () => {
        try {
          if (!this.textures.exists(texKey)) this.textures.addImage(texKey, img);
          face.setTexture(texKey).setDisplaySize(TILE * 0.62, TILE * 0.62);
        } catch {}
      };
      img.src = photoData;
      // Late-join photo arrival: schema syncs after onAdd — re-check once.
      if (!isMe && !player.avatarPhoto) {
        const poll = setInterval(() => {
          const p2 = this.room?.state?.players.get(id);
          if (p2?.avatarPhoto) { clearInterval(poll); if (!this.players.has(id) || this.players.get(id) === p2) return; }
        }, 400);
        setTimeout(() => clearInterval(poll), 5000);
      }
    }
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
    (ui as any).schema = player;
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
    // Poll fallback for remote positions (schema instance events unreliable across versions):
    if (Date.now() - (this as any).pollT > 250) {
      (this as any).pollT = Date.now();
      // Reconcile roster: add players who joined but whose onAdd never fired,
      // and drop ghosts whose onRemove never fired (schema events unreliable).
      try {
        const st = (this.room?.state?.players || new Map()) as Map<string, any>;
        for (const [rid, sp] of st) {
          if (!this.players.has(rid)) this.addPlayer(rid, sp);
        }
        for (const id of [...this.players.keys()]) {
          if (id !== this.myId && !st.has(id)) this.removePlayer(id);
        }
      } catch (e) { console.warn("[roster]", e); }
      for (const [id, p] of this.players) {
        if (id === this.myId) continue;
        const sp = (p as any).schema;
        if (!sp) continue;
        const sx2 = sp.x * TILE + TILE / 2, sy2 = sp.y * TILE + TILE / 2;
        if (Math.abs(sx2 - p.worldX) > 1 || Math.abs(sy2 - p.worldY) > 1) {
          this.onServerPosition(id, sp);
        }
      }
    }
    this.updateSpatialAudio();
    try { this.renderMinimap(); } catch (e) { console.warn("[minimap]", e); }
    try { this.renderUserList(); } catch (e) { console.warn("[userlist]", e); }
  }
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

// Green Room replaces the plain handle form: permissions → devices → photo → enter.
const gr = runGreenRoom();
gr.then((res: GreenRoomResult) => {
  // Expose for bubbles: photo dataURL becomes the remote-visible avatar image
  (window as any).__greenroom = res;
  const scene = game.scene.scenes[0] as WorldScene;
  scene.connect(res.handle);
});

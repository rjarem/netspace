import Phaser from "phaser";
import { Client, Room } from "colyseus.js";

const TILE = 32;

// Client-side copy of restricted zones + walls (mirrors server world.ts).
// Attendee is the dev default role; zones list which roles may enter.
const RESTRICTED_ZONES = [
  { x: 15, y: 2, w: 10, h: 5, allowed: ["admin", "speaker"] },          // Main Stage
  { x: 6, y: 14, w: 5, h: 4, allowed: ["admin", "speaker", "panelist"] }, // Round Table
  { x: 26, y: 6, w: 8, h: 6, allowed: ["admin", "speaker", "dj"] },      // DJ Lounge
];
const WALLY = (x: number, y: number) =>
  y === 0 || y === 29 || x === 0 || x === 39 ||
  (x === 14 && y >= 5 && y < 12) || (x === 30 && y >= 18 && y < 24);

function tileBlocked(x: number, y: number): boolean {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (WALLY(tx, ty)) return true;
  for (const z of RESTRICTED_ZONES) {
    if (tx >= z.x && tx < z.x + z.w && ty >= z.y && ty < z.y + z.h) {
      if (!z.allowed.includes("attendee")) return true;
    }
  }
  return false;
}

interface PlayerUI {
  sprite: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

class WorldScene extends Phaser.Scene {
  room: Room<any> | null = null;
  myId = "";
  players: Map<string, PlayerUI> = new Map();
  cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  target: { x: number; y: number } | null = null;
  proximity: Record<string, number> = {};
  tickInterval: any = null;

  constructor() { super("world"); }

  create() {
    const mapW = 40, mapH = 30;

    this.add.rectangle(mapW * TILE / 2, mapH * TILE / 2, mapW * TILE, mapH * TILE, 0x1c2130);

    const g = this.add.graphics();
    g.lineStyle(1, 0x232838, 1);
    for (let x = 0; x <= mapW; x++) g.lineBetween(x * TILE, 0, x * TILE, mapH * TILE);
    for (let y = 0; y <= mapH; y++) g.lineBetween(0, y * TILE, mapW * TILE, y * TILE);

    drawZone(this, 15, 2, 10, 5, "Main Stage", 0x7c4dff, 0.25);
    drawZone(this, 6, 14, 5, 4, "Round Table", 0x00bfa5, 0.25);
    drawZone(this, 26, 6, 8, 6, "DJ Lounge", 0xff5251, 0.25);

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
        // Exclusive: pressing a new arrow releases the previous one. Missed
        // keyup events (alt-tab, browser quirks) otherwise leave a stale
        // direction stuck true and the else-if chain moves the WRONG way.
        this.keyState = { left: false, right: false, up: false, down: false, [dir]: true } as any;
      } else {
        (this.keyState as any)[dir] = false;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", (e) => setKey(e, true));
    window.addEventListener("keyup", (e) => setKey(e, false));
    // Phaser's own cursor-key listeners can capture/consume arrow keys via its
    // keyboard plugin (and capture) without ours firing state changes — disable
    // capture so arrows always reach the DOM listeners above.
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
      room.state.players.onChange((player: any, id: string) => this.movePlayer(id, player));

      room.onMessage("proximity", (data: Record<string, Record<string, number>>) => {
        this.proximity = data[this.myId] || {};
        this.updateProximityVisuals();
      });
      room.onMessage("livekit", (msg: any) => {
        console.log("[livekit]", msg.isViewer ? "viewer" : "publisher", msg.zoneId);
        this.pushDbg("livekit-msg:" + msg.zoneId + ":" + (msg.isViewer ? "viewer" : "pub"));
        this.joinVoice(msg);
      });

      this.tickInterval = setInterval(() => this.tick(), 120);
      const st = document.getElementById("status");
      if (st) st.textContent = "✅ Conectado — click para moverte";
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

  tick() {
    if (!this.room) return;
    const me = this.players.get(this.myId);
    if (!me) {
      this.pushDbg("tick:no-me:" + this.myId);
      return;
    }
    const px = me.sprite.x / TILE, py = me.sprite.y / TILE;
    let tx = px, ty = py;
    if (this.keyState.left || this.keyState.right || this.keyState.up || this.keyState.down) {
      this.pushDbg("tick:key:" + JSON.stringify(this.keyState));
    }

    if (this.target) {
      tx = this.target.x; ty = this.target.y;
      // Mouse target expiry: if key is pressed, keys take priority and the
      // stale target is dropped — otherwise a rejected/stuck target blocks
      // arrow movement forever.
      if (this.keyState.left || this.keyState.right || this.keyState.up || this.keyState.down) {
        this.target = null;
      }
    } else if (this.keyState.left) tx -= 1;
    else if (this.keyState.right) tx += 1;
    else if (this.keyState.up) ty -= 1;
    else if (this.keyState.down) ty += 1;
    else return;

    // Arrow movement is relative to the SERVER position, not the local optimistic
    // sprite — otherwise optimistic mouse moves desync and keys appear dead.
    const sx = me.sprite.x / TILE, sy = me.sprite.y / TILE;
    if (this.target === null && (Math.abs(sx - tx) > 0.6 || Math.abs(sy - ty) > 0.6)) {
      // sprite drifted from server pos; snap back so arrows resume from truth
      me.sprite.x = Math.round(px) * TILE + TILE / 2;
      me.sprite.y = Math.round(py) * TILE + TILE / 2;
    }

    this.room.send("move", { x: Math.round(tx), y: Math.round(ty) });
    // Optimistic local move ONLY if the target tile is legal (mirrors server rules).
    // Own schema changes don't echo back to the sender, so we draw locally.
    if (!tileBlocked(tx, ty)) {
      me.sprite.x = Math.round(tx) * TILE + TILE / 2;
      me.sprite.y = Math.round(ty) * TILE + TILE / 2;
      me.label.x = me.sprite.x;
      me.label.y = me.sprite.y - TILE * 0.85;
    }
    if (this.target && Math.abs(px - tx) < 0.1 && Math.abs(py - ty) < 0.1) this.target = null;
  }

  keyState: { left: boolean; right: boolean; up: boolean; down: boolean } = { left: false, right: false, up: false, down: false };

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
      room.on(RoomEvent.TrackSubscribed, () => this.updateVoiceStatus());
      room.on(RoomEvent.TrackUnsubscribed, () => this.updateVoiceStatus());
      await room.connect(msg.url, msg.token);
      this.lkRoom = room;
      this.pushDbg("voice-ok:" + msg.zoneId);
      // Render remote participants: audio plays, video shows in a floating tile
      room.on(RoomEvent.TrackSubscribed, (track: any, pub: any, participant: any) => {
        if (track.kind === "audio") track.attach();
        else if (track.kind === "video") this.showRemoteVideo(participant.identity, track);
        this.updateVoiceStatus();
      });
      room.on(RoomEvent.TrackUnsubscribed, (track: any) => {
        if (track.kind === "video") this.removeRemoteVideo(track);
        this.updateVoiceStatus();
      });
      // Already-subscribed tracks (e.g. on rejoin)
      for (const p of room.remoteParticipants.values()) {
        for (const pub of p.trackPublications.values()) {
          if (pub.isSubscribed && pub.track) {
            if (pub.track.kind === "audio") pub.track.attach();
            else this.showRemoteVideo(p.identity, pub.track);
          }
        }
      }
      // Local self-preview (bottom-left)
      room.on(RoomEvent.LocalTrackPublished, (pub: any) => {
        if (pub.track?.kind === "video") this.showLocalPreview(pub.track);
      });
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
    const base = "✅ Conectado — click para moverte";
    st.textContent = n > 0 ? `${base} | 🎙️ ${n} en voz` : base;
  }

  /** Floating video overlay container (top-right). */
  videoLayer(): HTMLElement {
    let layer = document.getElementById("videoLayer") as HTMLElement | null;
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "videoLayer";
      layer.style.cssText = "position:fixed;top:10px;right:10px;display:flex;flex-direction:column;gap:8px;z-index:1000;";
      document.body.appendChild(layer);
    }
    return layer;
  }

  /** Show a remote participant's video tile. */
  showRemoteVideo(identity: string, track: any) {
    const tileId = "vid-" + identity;
    let tile = document.getElementById(tileId);
    if (!tile) {
      tile = document.createElement("div");
      tile.id = tileId;
      tile.style.cssText = "width:220px;height:125px;background:#000;border:2px solid #4f7cff;border-radius:6px;overflow:hidden;position:relative;";
      const name = document.createElement("div");
      name.style.cssText = "position:absolute;top:2px;left:4px;font:11px system-ui;color:#fff;background:#000000aa;padding:1px 5px;border-radius:3px;";
      name.textContent = identity.slice(0, 12);
      tile.appendChild(name);
      this.videoLayer().appendChild(tile);
    }
    if (typeof track.attach === "function") track.attach(tile);
    const rvid = tile.querySelector("video") as HTMLVideoElement | null;
    rvid?.play().catch(() => {});
    this.pushDbg("video-remote:" + identity);
  }

  /** Remove a remote video tile when their track is gone. */
  removeRemoteVideo(track: any) {
    const el = track.attachedElements?.[0];
    if (el?.parentElement?.id?.startsWith("vid-")) el.parentElement.remove();
  }

  /** Self preview, bottom-left, small. */
  showLocalPreview(pubOrTrack: any) {
    // LocalTrackPublished passes a publication — use its .track
    const track = pubOrTrack?.track ?? pubOrTrack;
    if (typeof track?.attach !== "function") return;
    let tile = document.getElementById("selfPreview");
    if (!tile) {
      tile = document.createElement("div");
      tile.id = "selfPreview";
      tile.style.cssText = "position:fixed;bottom:12px;left:12px;width:180px;height:102px;background:#000;border:2px solid #00c853;border-radius:6px;overflow:hidden;z-index:1000;";
      const name = document.createElement("div");
      name.style.cssText = "position:absolute;top:2px;left:4px;font:11px system-ui;color:#fff;background:#000000aa;padding:1px 5px;border-radius:3px;z-index:2;";
      name.textContent = "Tú";
      tile.appendChild(name);
      document.body.appendChild(tile);
    }
    // attach() needs an HTMLMediaElement (video), not a div
    let vid = tile.querySelector("video") as HTMLVideoElement | null;
    if (!vid) {
      vid = document.createElement("video");
      vid.style.cssText = "width:100%;height:100%;object-fit:cover;transform:scaleX(-1);";
      vid.autoplay = true; vid.playsInline = true; vid.muted = true;
      tile.appendChild(vid);
    }
    track.attach(vid);
    vid.play().catch(() => {});
    this.pushDbg("video-self");
  }

  /** The browser's error above revealed attach() expects a track object with play();
   * LocalTrackPublished passes a publication — extract its track first. */

  addPlayer(id: string, player: any) {
    if (this.players.has(id)) return;
    const colors: Record<string, number> = {
      blue: 0x4f7cff, green: 0x00c853, orange: 0xff9100, purple: 0xaa00ff,
    };
    const color = colors[player.avatarStyle] || 0x4f7cff;
    const isMe = id === this.myId;
    const sprite = this.add.rectangle(
      player.x * TILE + TILE / 2, player.y * TILE + TILE / 2,
      TILE * 0.7, TILE * 0.7, color, 1
    );
    if (isMe) sprite.setStrokeStyle(3, 0xffffff, 1);
    const label = this.add.text(
      sprite.x, sprite.y - TILE * 0.9, player.handle + (isMe ? " (yo)" : ""),
      { font: "12px system-ui", color: "#fff", backgroundColor: "#00000088", padding: { x: 4, y: 2 } }
    ).setOrigin(0.5);
    this.players.set(id, { sprite, label });
    this.cameras.main.startFollow(sprite, true, 0.1, 0.1);
  }

  removePlayer(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    p.sprite.destroy(); p.label.destroy();
    this.players.delete(id);
  }

  movePlayer(id: string, player: any) {
    const p = this.players.get(id);
    if (!p) return;
    this.tweens.add({
      targets: [p.sprite, p.label],
      x: player.x * TILE + TILE / 2,
      y: player.y * TILE + TILE / 2,
      duration: 110,
      onUpdate: () => { p.label.x = p.sprite.x; p.label.y = p.sprite.y - TILE * 0.85; },
    });
  }

  updateProximityVisuals() {
    for (const [id, p] of this.players) {
      if (id === this.myId) continue;
      const vol = this.proximity[id] ?? 0;
      p.sprite.setStrokeStyle(Math.round(vol * 3), 0xffffff, Math.min(1, vol * 1.5));
    }
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
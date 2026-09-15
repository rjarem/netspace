import Phaser from "phaser";
import { Client, Room } from "colyseus.js";
import {
  TILE, APP_VERSION, AUDIO_RADIUS, AUDIO_MAX_RADIUS,
  tileBlocked, drawZone, PlayerUI,
} from "./constants";
import { joinVoice, updateVoiceStatus, onRemoteAudio, updateSpatialAudio, updateSubscriptions } from "./voice";
import { onRemoteVideo, removeRemoteVideo, ensureBubble, showLocalPreview, updateBubbles } from "./bubbles";
import { renderMinimap, renderUserList } from "./hud";
import { installActionBar } from "./actionbar";
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
  // Fase 5a: `proximity` y el broadcast server-side ELIMINADOS — la suscripción
  // de audio/video se reevalúa localmente cada 500ms (updateSpatialAudio) con
  // distancias locales, y el volumen espacial es continuo por frame.
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
      // Fix (Tito, 14-sep): pinch-zoom (2 dedos) no debe mover el avatar.
      if ((this as any).pinching) return;
      this.target = {
        x: Math.floor(pointer.worldX / TILE),
        y: Math.floor(pointer.worldY / TILE),
      };
    });
    this.cameras.main.setBounds(0, 0, mapW * TILE, mapH * TILE);
  }


  async connect(handle: string, invite?: string | null) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    // Corrección 1 (auditor, 14-sep): el bypass ?probe= de headless gates fuerza
    // el server local — con puerto 4173 la detección por puerto caía al branch
    // de prod (wss://api.localhost) y el gate C no pegaba al server local.
    const isProbe = new URLSearchParams(location.search).has("probe");
    // Fase 3 debugging (auditor-prescrito): log de cada paso del flujo a
    // /api/probelog para depurar joins headless sin consola visible.
    const plog = (s: string) => {
      if (!isProbe) return;
      try { fetch("http://127.0.0.1:2567/api/probelog?m=" + encodeURIComponent(`${handle}: ${s}`)).catch(() => {}); } catch {}
    };
    window.onerror = (msg) => { plog("onerror: " + String(msg).slice(0, 200)); };
    plog("connect() called, isProbe=" + isProbe);
    // Producción: Colyseus en api.turedvirtual.vip; dev: localhost:2567.
    // El bypass ?probe= acepta ?probe=<handle>&probeUrl=<ws-url> para apuntar
    // a PROD desde los gates headless (default: server local 127.0.0.1:2567).
    const probeUrl = new URLSearchParams(location.search).get("probeUrl");
    const server = isProbe
      ? (probeUrl || "ws://127.0.0.1:2567")
      : location.port === "5173"
      ? "ws://localhost:2567"
      : `${proto}://api.${location.hostname.replace(/^play\./, "")}`;
    plog("server=" + server);
    const client = new Client(server);
    try {
      plog("joinOrCreate...");
      // Fase 5b (criterio 2, auditor): invitación JWT. Si la Antesala capturó
      // un ?invite=<jwt> (link) o un código pegado, ese JWT ES el token de
      // join (el server lo valida en onAuth). Sin invitación: dev-token
      // (solo aceptado mientras DEV_NO_AUTH=1; cuando se apague, sin JWT no
      // hay entrada).
      // Fase 5b (criterio 9): los probes se marcan isProbe — el server les
      // niega voz (canPublish/canSubscribe false) para aislarlos de usuarios reales.
      const joinToken = invite || btoa(`dev:${handle}`);
      const room = (await client.joinOrCreate("world", { token: joinToken, isProbe })) as Room<any>;
      plog("joined roomId=" + room.id);
      // Hallazgo Tito 16-sep (auditor lo adelantó): el canvas heredaba el
      // tamaño de la ventana EN el arranque y quedaba clavado (columna
      // vertical). Forzar scale.refresh() espaciado tras el join lo corrige.
      for (const delay of [200, 800, 2000]) {
        setTimeout(() => { try { this.game?.scale?.refresh?.(); } catch { /* */ } }, delay);
      }
      // Fase 0 (auditoría 14-sep): v2b-guard DESHABILITADO. Los guards client-side
      // NUNCA hacen leave+rejoin — solo deshabilitan features. El handshake de
      // versión ahora es server→client: el server anuncia su build SHA en el
      // state (serverBuild) y el cliente solo lo loggea.
      console.log("v2b: disabled");
      // Fase 1.2: handshake server→client — el cliente espera el PRIMER
      // onStateChange (no timeout fijo) y loggea el build SHA del server.
      // NUNCA rejoin: si el SHA no está en allow-list, solo se deshabilitan
      // features (aquí: ninguna por ahora) y queda marcado en consola.
      await new Promise<void>((res) => {
        const done = (st: any) => {
          const sha = st?.serverBuild || (room.state as any)?.serverBuild || "unknown";
          console.log("connected to", sha);
          // Fase 5a (auditor, H14): bloqueo DURO por versión. Un bundle viejo
          // contra server nuevo antes seguía en sesión degradada (síntoma:
          // "los movimientos no se reflejaban"). Ahora: overlay de recarga.
          // Fase 5a (H14, v4 final): detectar deploy NUEVO, no sha exacto.
          // El sha embebido en el bundle nunca coincide con el BUILD_SHA del
          // compose (el build corre antes del commit final / amend cambia el
          // sha). La señal REAL de sesión degradada es: el serverBuild de esta
          // visita difiere del que este navegador vio la última vez.
          const prev = localStorage.getItem("gr-server-build");
          localStorage.setItem("gr-server-build", sha);
          if (prev && sha !== "unknown" && prev !== sha) {
            console.warn("SERVER BUILD CHANGED:", prev, "→", sha);
            location.reload(); // auto-reload UNA vez (caché de HTML viejo)
            return;
          }
          res();
        };
        room.onStateChange.once(done);
        setTimeout(() => done((room.state as any)), 3000); // safety net, no rejoin
      });
      this.room = room;
      (window as any).__grScene = this; // debug/diagnostics hook (prod-safe: read-only)
      this.myId = room.sessionId;
      // Corrección 2 (auditor, 14-sep): el listener del ack va UNA sola vez,
      // FUERA del retry loop — si va dentro, el server puede responder antes
      // de que el listener del intento esté registrado → falso negativo.
      room.onMessage("avatar-ok", () => { (this as any).avatarOk = true; });
      // Fix (Tito, 14-sep): fotos cruzadas no visibles — el resend del server
      // (onJoin → client.send avatar) llega ANTES de que este listener esté
      // registrado, porque sendAvatar() lo precede con awaits de backoff.
      // El listener va PRIMERO, antes de cualquier await.
      room.onMessage("avatar", (msg: { sessionId: string; photo: string }) => {
        if (msg.sessionId === this.myId) return; // self usa copia local
        this.applyRemotePhoto(msg.sessionId, msg.photo);
        (this as any).remotePhotos = (this as any).remotePhotos || new Map();
        (this as any).remotePhotos.set(msg.sessionId, msg.photo);
      });
      const myPhoto = (window as any).__greenroom?.avatarPhoto;
      if (myPhoto) {
        let attempt = 0;
        const sendAvatar = async () => {
          while (attempt < 4 && !(this as any).avatarOk) {
            room.send("avatar", { photo: myPhoto });
            const ok = await new Promise<boolean>((res) => {
              const t = setTimeout(() => res(false), 1000 * Math.pow(2, attempt));
              const check = setInterval(() => {
                if ((this as any).avatarOk) { clearInterval(check); clearTimeout(t); res(true); }
              }, 100);
            });
            if (ok) break;
            attempt++;
          }
        };
        sendAvatar();
      }
      room.state.players.onAdd((player: any, id: string) => this.addPlayer(id, player));
      room.state.players.onRemove((_: any, id: string) => this.removePlayer(id));

      room.onMessage("livekit", (msg: any) => {
        console.log("[livekit]", msg.isViewer ? "viewer" : "publisher", msg.zoneId);
        this.pushDbg("livekit-msg:" + msg.zoneId + ":" + (msg.isViewer ? "viewer" : "pub"));
        this.joinVoice(msg);
      });

      // Fase 6: moderación — avisos y expulsión
      room.onMessage("mod-notice", (msg: any) => {
        const st = document.getElementById("status");
        const label: Record<string, string> = {
          mute: `🙊 ${msg.target} muteado por ${msg.by}`,
          unban: `✅ ${msg.target} desbaneado`,
          ban: `⛔ ${msg.target} baneado por ${msg.by}`,
          kick: `👢 ${msg.target} expulsado por ${msg.by}`,
          "mute-blocked": `🙊 Tu mic está muteado por ${msg.by} — no puedes desmutearlo`,
        };
        if (st) st.textContent = label[msg.type] || `mod:${msg.type}`;
        console.log("[mod]", msg.type, msg.target || "", msg.by || "");
        // el estado de la sala ya sincronizó mutedBy — refrescar píldoras
        try { this.renderUserList(); } catch { /* */ }
      });

      room.onMessage("kicked", (msg: any) => {
        console.warn("[mod] kicked:", msg?.kind, "by", msg?.by);
        // Volver a la Antesala con aviso — sin auto-reconnect (el token está
        // invalidado server-side; re-entrar con el mismo link daría 403).
        try { this.room?.leave(true); } catch { /* */ }
        // H4 (auditor): desconectar TAMBIÉN la voz — el token LiveKit vive ~6h;
        // sin esto el expulsado seguía oyendo (y hablando) el evento.
        try { this.lkRoom?.disconnect(); } catch { /* */ }
        const ov = document.createElement("div");
        ov.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(15,17,23,.97);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:#e6e6e6;font-family:system-ui,sans-serif;text-align:center;padding:24px;";
        const h = document.createElement("div");
        h.textContent = msg?.kind === "ban" ? "⛔ Fuiste baneado del evento" : "👢 Fuiste expulsado";
        h.style.cssText = "font-size:22px;font-weight:600;";
        const p2 = document.createElement("div");
        p2.textContent = msg?.kind === "ban"
          ? "El organizador te bloqueó permanentemente."
          : `Expulsado por ${msg?.by || "un moderador"}. Pide un nuevo link para volver.`;
        p2.style.cssText = "font-size:14px;color:#9aa;max-width:320px;";
        ov.append(h, p2);
        document.body.appendChild(ov);
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

    // Fase 7: barra de acciones flotante (mic, emojis, salir) — decisión Tito 15-sep
    try { installActionBar(this); } catch (e) { console.warn("[actionbar]", e); }

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
    // Fase 5c (auditor): en probe mode, pushDbg también va a /api/probelog —
    // los eventos de voz (TrackSubscribed→audio-remote) son la señal clave.
    const ph = new URLSearchParams(location.search).get("probe");
    if (ph) {
      try { fetch("http://127.0.0.1:2567/api/probelog?m=" + encodeURIComponent(`${ph}: dbg:${s}`)).catch(() => {}); } catch {}
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
    // Avatar: photo from Antesala — self uses local copy, others arrive via
    // the "avatar" MESSAGE (Fase 1.3 — no longer in the synced schema).
    let face: Phaser.GameObjects.Image = this.add.image(wx, wy, "avatar-default").setDisplaySize(TILE * 0.62, TILE * 0.62);
    const localPhoto = (isMe && (window as any).__greenroom?.avatarPhoto) || "";
    const msgPhoto = (!(isMe) && ((this as any).remotePhotos as Map<string, string> | undefined)?.get(id)) || "";
    const photoData = localPhoto || msgPhoto || "";
    if (photoData) {
      this.setTextureFromData(face, "avatar-photo-" + id, photoData);
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
    if (photoData) (ui as any).facePhoto = photoData; // para ensureBubble
    (ui as any).schema = player;
    (ui as any).faceRef = face;
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

  /** Fase 1.3/2.3: apply a dataURL to a player's face texture (decode-safe). */
  applyRemotePhoto(id: string, photo: string) {
    const p = this.players.get(id);
    if (p) {
      const face = (p as any).faceRef as Phaser.GameObjects.Image;
      this.setTextureFromData(face, "avatar-photo-" + id, photo);
      (p as any).facePhoto = photo;
      // Fix (Tito, 14-sep): la burbuja DOM es lo que el usuario ve — actualízala.
      const bi = (p as any).bubbleImg as HTMLImageElement | undefined;
      if (bi) bi.src = photo;
    }
  }

  /** Decode a dataURL fully BEFORE touching Phaser textures (avoids the race). */
  setTextureFromData(face: Phaser.GameObjects.Image, texKey: string, data: string) {
    if (!data) return;
    const img = new Image();
    img.onload = () => {
      try {
        if (!this.textures.exists(texKey)) this.textures.addImage(texKey, img);
        face.setTexture(texKey).setDisplaySize(TILE * 0.62, TILE * 0.62);
      } catch {}
    };
    img.src = data;
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

// Fase 5a (H14, v4): overlay manual si el usuario sigue en una sesión degradada
// tras el auto-reload (reservado; el flujo principal es auto-reload una vez).
function showReloadOverlay(serverSha: string) {
  if (document.getElementById("versionOverlay")) return;
  const ov = document.createElement("div");
  ov.id = "versionOverlay";
  ov.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(15,17,23,.97);" +
    "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;" +
    "color:#e6e6e6;font-family:system-ui,sans-serif;text-align:center;padding:24px;";
  const h = document.createElement("div");
  h.textContent = "🔄 Hay una versión nueva";
  h.style.cssText = "font-size:22px;font-weight:600;";
  const p = document.createElement("div");
  p.textContent = "La app se actualizó. Toca el botón para continuar.";
  p.style.cssText = "font-size:14px;color:#9aa;max-width:320px;";
  const b = document.createElement("button");
  b.textContent = "Actualizar ahora";
  b.style.cssText = "padding:12px 28px;border:none;border-radius:8px;background:#4f7cff;" +
    "color:#fff;font-size:16px;cursor:pointer;";
  b.onclick = () => location.reload();
  ov.append(h, p, b);
  document.body.appendChild(ov);
}

// Fix (Tito, 14-sep): al rotar el teléfono quedaba media pantalla negra —
// el canvas no seguía el cambio de orientación. RESIZE mode + refresh forzado.
const refreshScale = () => { try { game.scale.refresh(); } catch {} };
window.addEventListener("resize", refreshScale);
window.addEventListener("orientationchange", () => setTimeout(refreshScale, 120));

// Green Room replaces the plain handle form: permissions → devices → photo → enter.
// Fase 3: headless probe bypass — ?probe=<handle> entra directo (sin Antesala);
// el roomId queda en el log estructurado del server para el gate cross2.
const probeHandle = new URLSearchParams(location.search).get("probe");
if (probeHandle) {
  // Instrumentación temprana (auditor-prescrito): plog apunta al server
  // colyseus (2567) — el static server (4175) no tiene /api/probelog.
  (window as any).plog = (s: string) => {
    try { fetch("http://127.0.0.1:2567/api/probelog?m=" + encodeURIComponent(`${probeHandle}: ${s}`)).catch(() => {}); } catch {}
    try { document.title = "PL:" + s.slice(0, 60); } catch {}
  };
  (window as any).plog("bypass activado");
  (window as any).__greenroom = { handle: probeHandle, avatarPhoto: null, invite: null };
  // BUG FOUND (gate C): las scenes de Phaser bootean ASYNC — en este punto
  // scene.scenes[0] es undefined y connect() nunca se llamaba (el join no
  // llegaba al server). En el flujo normal la Antesala tarda segundos y
  // enmascaraba el race. Esperar a que la scene esté activa.
  const waitScene = () => {
    const s = (game.scene as any).scenes?.[0];
    if (s) {
      (window as any).plog("scene ready, calling connect");
      // Fase 5b: probes también pueden entrar con ?invite=<jwt> (gate de
      // entrada con auth real, criterio 5 del auditor).
      s.connect(probeHandle, new URLSearchParams(location.search).get("invite"));
    } else {
      setTimeout(waitScene, 100);
    }
  };
  waitScene();
} else {
  const gr = runGreenRoom();
  gr.then((res: GreenRoomResult) => {
    // Expose for bubbles: photo dataURL becomes the remote-visible avatar image
    (window as any).__greenroom = res;
    const scene = game.scene.scenes[0] as WorldScene;
    // Fase 5b (criterio 2): el JWT de invitación viaja al join
    scene.connect(res.handle, res.invite);
  });
}

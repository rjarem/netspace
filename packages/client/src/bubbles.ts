// Video bubbles overlay (T1) — extracted from main.ts (behavior unchanged).
import Phaser from "phaser";
import { TILE, PlayerUI } from "./constants";

type SC = any; // WorldScene (loose to avoid circular imports)


export function bubbleLayer(sc: SC): HTMLElement {
    let layer = document.getElementById("bubbleLayer") as HTMLElement | null;
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "bubbleLayer";
      layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:900;overflow:hidden;";
      document.body.appendChild(layer);
    }
    return layer;
  }

export function onRemoteVideo(sc: SC, identity: string, track: any) {
    const p = sc.players.get(identity);
    if (!p) {
      setTimeout(() => onRemoteVideo(sc, identity, track), 300);
      return;
    }
    ensureBubble(sc, p, identity);
    if (typeof track.attach === "function" && p.video) {
      track.attach(p.video);
      p.video.play().catch(() => {});
      const av = p.bubble?.querySelector("img"); if (av) av.style.display = "none";
    }
    sc.pushDbg("video-remote:" + identity);
  }

export function removeRemoteVideo(sc: SC, identity: string) {
    const p = sc.players.get(identity);
    if (p?.bubble && p.video) {
      // keep the bubble (avatar), just clear the video stream
      p.video.srcObject = null;
      p.video.style.display = "none";
      p.bubble.dataset.hasVideo = "0";
      const av = p.bubble.querySelector("img"); if (av) av.style.display = "block";
    }
  }

export function ensureBubble(sc: SC, p: PlayerUI, identity: string) {
    if (p.bubble) return p.bubble;
    const isMe = identity === sc.myId || sc.players.get(sc.myId) === p;
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
    bubbleLayer(sc).appendChild(b);
    p.bubble = b;
    p.video = v;
    // Fix (Tito, 14-sep): la burbuja siempre mostraba avatar-default.png (emoji)
    // — la foto de cámara nunca se pintaba aquí. Exponer el <img> para que
    // addPlayer/applyRemotePhoto lo actualicen con el dataURL.
    p.bubbleImg = av;
    const pd = (isMe && (window as any).__greenroom?.avatarPhoto)
      || (sc.players.get(identity) as any)?.facePhoto || "";
    if (pd && !isMe) { av.src = pd; }
    return b;
  }

export function showLocalPreview(sc: SC, pubOrTrack: any) {
    const track = pubOrTrack?.track ?? pubOrTrack;
    if (typeof track?.attach !== "function") return;
    const me = sc.players.get(sc.myId);
    if (!me) { setTimeout(() => showLocalPreview(sc, pubOrTrack), 300); return; }
    const b = ensureBubble(sc, me, sc.myId);
    const nameTag = b.querySelector("div") as HTMLElement;
    if (nameTag) nameTag.textContent = "Tú";
    if (me.video) {
      track.attach(me.video);
      me.video.style.display = "";
      me.video.play().catch(() => {});
      b.dataset.hasVideo = "1";
      const av = b.querySelector("img"); if (av) av.style.display = "none";
    }
    sc.pushDbg("video-self");
  }

export function updateBubbles(sc: SC) {
    const cam = sc.cameras.main;
    const zoom = cam.zoom;
    for (const p of sc.players.values()) {
      if (!p.bubble) continue;
      const view = cam.worldView; // exact rendered viewport (accounts for follow lerp/effects)
      const sx = (p.sprite.x - view.x) * zoom;
      const sy = (p.sprite.y - view.y) * zoom;
      const sz = Math.round(84 * zoom);
      p.bubble.style.width = sz + "px";
      p.bubble.style.height = sz + "px";
      p.bubble.style.transform = `translate3d(${sx - sz / 2}px,${sy - sz / 2}px,0)`;
      // video visible only when actually streaming
      if (p.video && p.video.srcObject) p.video.style.display = "";
      else if (p.video) p.video.style.display = "none";
    }
  }

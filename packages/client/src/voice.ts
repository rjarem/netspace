// Voice (LiveKit) + spatial audio — extracted from main.ts (behavior unchanged).
import Phaser from "phaser";
import { TILE, APP_VERSION, AUDIO_RADIUS, AUDIO_MAX_RADIUS, PlayerUI } from "./constants";

type SC = any; // WorldScene (kept loose to avoid circular imports)


export async function joinVoice(sc: SC, msg: { token: string; url: string; zoneId: string; isViewer?: boolean }) {
    if (!msg.token || !msg.url) return;
    if (sc.lkZone === msg.zoneId && sc.lkRoom) return; // already in this zone
    sc.lkZone = msg.zoneId;
    try {
      if (sc.lkRoom) { await sc.lkRoom.disconnect(); sc.lkRoom = null; }
      const { Room, RoomEvent } = await import("livekit-client");
      const room = new Room({ adaptiveStream: true, dynacast: true });
      room.on(RoomEvent.TrackSubscribed, (track: any, pub: any, participant: any) => {
        if (track.kind === "audio") sc.onRemoteAudio(participant.identity, track);
        else if (track.kind === "video") sc.onRemoteVideo(participant.identity, track);
        sc.updateVoiceStatus();
      });
      room.on(RoomEvent.TrackUnsubscribed, (track: any, pub: any, participant: any) => {
        if (track.kind === "video") sc.removeRemoteVideo(participant.identity);
        sc.updateVoiceStatus();
      });
      room.on(RoomEvent.LocalTrackPublished, (pub: any) => {
        if (pub.kind === "video") sc.showLocalPreview(pub);
      });
      await room.connect(msg.url, msg.token);
      sc.lkRoom = room;
      sc.pushDbg("voice-ok:" + msg.zoneId);
      // If camera was already published (rejoin), attach now
      for (const pub of room.localParticipant.trackPublications.values()) {
        if (pub.kind === "video" && pub.track) sc.showLocalPreview(pub);
      }
      // Already-subscribed tracks (e.g. on rejoin)
      for (const p of room.remoteParticipants.values()) {
        for (const pub of p.trackPublications.values()) {
          if (pub.isSubscribed && pub.track) {
            if (pub.track.kind === "audio") sc.onRemoteAudio(p.identity, pub.track);
            else sc.onRemoteVideo(p.identity, pub.track);
          }
        }
      }
      // Publish mic audio (browser will prompt for permission the first time)
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
        sc.updateVoiceStatus();
      } catch (micErr) {
        console.warn("[voice] mic permission denied or unavailable:", micErr);
      }
      // Publish camera too (only allowed for non-viewer roles; harmless no-op otherwise)
      if (!msg.isViewer) {
        try {
          await room.localParticipant.setCameraEnabled(true);
          sc.pushDbg("cam-ok:" + msg.zoneId);
        } catch (camErr) {
          console.warn("[voice] camera permission denied or unavailable:", camErr);
          sc.pushDbg("cam-fail:" + (camErr as Error).message.slice(0, 120));
        }
      }
      console.log("[voice] connected to", msg.zoneId);
    } catch (e) {
      console.error("[voice] connect failed:", e);
      sc.pushDbg("voice-fail:" + (e as Error).message.slice(0, 120));
    }
  }

export function updateVoiceStatus(sc: SC) {
    const st = document.getElementById("status");
    if (!st) return;
    const n = sc.lkRoom?.remoteParticipants.size ?? 0;
    const base = "✅ " + APP_VERSION + " — conectado";
    st.textContent = n > 0 ? `${base} | 🎙️ ${n} en voz` : base;
  }

export function onRemoteAudio(sc: SC, identity: string, track: any) {
    const p = sc.players.get(identity);
    if (!p) {
      // participant may not have a sprite yet; stash and retry on render loop
      setTimeout(() => onRemoteAudio(sc, identity, track), 300);
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
    sc.pushDbg("audio-remote:" + identity);
  }

export function updateSpatialAudio(sc: SC) {
    // Re-evaluate proximity subscriptions periodically (players move!)
    if (Date.now() - (sc as any).subThrottle > 500) {
      (sc as any).subThrottle = Date.now();
      try { updateSubscriptions(sc); } catch { /* room not ready */ }
    }
    const me = sc.players.get(sc.myId);
    if (!me) return;
    for (const [id, p] of sc.players) {
      if (id === sc.myId) continue;
      const dist = Phaser.Math.Distance.Between(me.worldX, me.worldY, p.worldX, p.worldY) / TILE;
      // Smooth perceptual fade: full volume at ≤2 tiles → silent at 8 tiles.
      // Old curve (1.0 until 5 tiles, 0 at 8) felt binary: voice stays intelligible
      // at 0.3 gain, so users heard "on or off". Earlier start + exponential
      // taper makes distance audible.
      const t = Math.min(1, Math.max(0, (dist - 2) / (AUDIO_MAX_RADIUS - 2)));
      const vol = Math.pow(1 - t, 1.6); // exponential taper, 1.0 → 0.0
      // Stereo pan: normalized horizontal offset (±1 at the pan range)
      const dx = (p.worldX - me.worldX) / (AUDIO_MAX_RADIUS * TILE);
      const pan = Math.max(-1, Math.min(1, dx));
      if (p.audioNode) {
        // Belt-and-braces: resume ctx every frame (Chrome mobile suspends aggressively)
        if (p.audioNode.ctx.state === "suspended") p.audioNode.ctx.resume().catch(() => {});
        // setTargetAtTime = click-free ramp (~80ms time constant)
        try {
          p.audioNode.gain.gain.setTargetAtTime(vol, p.audioNode.ctx.currentTime, 0.08);
          p.audioNode.panner.pan.setTargetAtTime(pan, p.audioNode.ctx.currentTime, 0.08);
        } catch {
          p.audioNode.gain.gain.value = vol;
          p.audioNode.panner.pan.value = pan;
        }
      } else if (p.audioEl) {
        (p.audioEl as any).volume = vol;
      }
      // Sprite ring brightness tracks audible proximity too
      p.sprite.setStrokeStyle(Math.round(vol * 3), 0xffffff, Math.min(1, vol * 1.5));
    }
  }

export function updateSubscriptions(sc: SC) {
    if (!sc.lkRoom) return;
    const me = sc.players.get(sc.myId);
    if (!me) return;
    for (const p of sc.lkRoom.remoteParticipants.values()) {
      const sprite = sc.players.get(p.identity);
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

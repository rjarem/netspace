// Voice (LiveKit) + spatial audio — extracted from main.ts (behavior unchanged).
import Phaser from "phaser";
import { TILE, APP_VERSION, AUDIO_RADIUS, AUDIO_MAX_RADIUS, PlayerUI } from "./constants";

type SC = any; // WorldScene (kept loose to avoid circular imports)

// Fase 5a (escala): UN AudioContext compartido para todas las pistas remotas.
// Chrome tiene límite de ~6 AudioContexts por página — con N usuarios hablando
// se agotaban y las pistas nuevas quedaban mudas.
let sharedAudioCtx: AudioContext | null = null;
let resumeHooksBound = false;
export function getSharedAudioCtx(): AudioContext {
  // Fix R1 (auditor, 16-sep): removePlayer CERRABA este ctx compartido en cada
  // leave/poda de fantasmas — todas las voces morían y getSharedAudioCtx nunca
  // lo recreaba porque no era null. Ahora: si está closed, se recrea.
  if (!sharedAudioCtx || sharedAudioCtx.state === "closed") sharedAudioCtx = new AudioContext();
  (window as any).__nsVoiceCtx = sharedAudioCtx; // diag 16-sep
  const ctx = sharedAudioCtx;
  const resume = () => { if (ctx.state === "suspended") ctx.resume().catch(() => {}); };
  resume();
  if (!resumeHooksBound) {
    resumeHooksBound = true;
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);
    // Fix R5 (auditor): recuperar el ctx al volver el foco/visibilidad
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
  }
  return ctx;
}

// Fix R1/R3 (auditor, 16-sep): desmontar el chain de un jugador SIN cerrar el
// AudioContext compartido. removePlayer y el watchdog lo usan.
export function teardownAudioChain(sc: SC, p: any) {
  try { (p as any).__src?.disconnect(); } catch {}
  try { p.audioNode?.gain?.disconnect(); } catch {}
  try { p.audioNode?.panner?.disconnect(); } catch {}
  try { p.audioEl?.remove(); } catch {}
  (p as any).__src = null;
  (p as any).__srcTrack = null;
  p.audioNode = null;
  p.audioEl = null;
}

// Fix R2 (auditor, 16-sep): re-ligar la fuente al track VIGENTE usando SIEMPRE
// new MediaStream([track.mediaStreamTrack]) — track.mediaStream es opcional en
// el SDK y puede venir vacío (el rebind 749dd89 usaba ese campo).
export function rebindAudioSource(sc: SC, p: any, track: any): boolean {
  try {
    if (!p.audioNode || !track?.mediaStreamTrack) return false;
    const mst: MediaStreamTrack = track.mediaStreamTrack;
    if ((p as any).__srcTrack === mst) return true; // ya ligado
    const old = (p as any).__src;
    if (old) { try { old.disconnect(); } catch {} }
    const src = p.audioNode.ctx.createMediaStreamSource(new MediaStream([mst]));
    src.connect(p.audioNode.gain);
    (p as any).__src = src;
    (p as any).__srcTrack = mst;
    sc.pushDbg("audio-rebind:" + (p.handle || "?"));
    return true;
  } catch (e) {
    sc.pushDbg("audio-rebind-fail:" + (e as Error).message.slice(0, 60));
    return false;
  }
}

// Construir (o reconstruir) el chain WebAudio de un participante remoto.
function buildAudioChain(sc: SC, p: any, identity: string, track: any) {
  try {
    const ctx = getSharedAudioCtx();
    if (ctx.state === "closed") throw new Error("ctx closed tras recrear"); // no debería pasar
    p.audioEl?.remove();
    const keepAlive = document.createElement("audio");
    keepAlive.muted = true;
    keepAlive.autoplay = true;
    document.body.appendChild(keepAlive);
    try { track.attach(keepAlive); } catch { /* attach optional */ }
    // Fix A (auditor 17-sep): attachToElement (SDK Track.ts:414) hace
    // element.muted = (audioTracks.length === 0) → pisa nuestro muted=true a
    // false y el track suena a volumen 1.0 por el keepAlive, SIN atenuación
    // espacial e inmune a las ganancias WebAudio. Re-mute DESPUÉS del attach.
    keepAlive.muted = true;
    keepAlive.volume = 0;
    const mst = (track as any).mediaStreamTrack;
    const source = mst ? ctx.createMediaStreamSource(new MediaStream([mst])) : ctx.createMediaStreamSource((track as any).mediaStream);
    (p as any).__src = source;
    (p as any).__srcTrack = mst || null;
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    source.connect(gain).connect(panner).connect(ctx.destination);
    p.audioNode = { ctx, gain, panner };
    p.audioEl = keepAlive;
    sc.pushDbg("audio-build:" + identity);
  } catch (err) {
    console.warn("[audio] WebAudio failed, falling back to element:", err);
    const a = document.createElement("audio");
    a.autoplay = true;
    document.body.appendChild(a);
    try { (track as any).attach(a); } catch {}
    p.audioEl = a;
    p.audioNode = null;
  }
}

// Fix R1+R2+R3 (auditor): WATCHDOG reconciliador — corre ~1 vez/segundo desde
// updateSpatialAudio. Los eventos de LiveKit quedan como acelerador; la verdad
// es el estado observado: chain ausente → construir; ligado a track viejo →
// rebind; ctx suspendido → resume; ctx cerrado → teardown+rebuild sobre ctx nuevo.
function audioWatchdog(sc: SC) {
  try {
    const room = sc.lkRoom;
    if (!room) return;
    const ctx = getSharedAudioCtx();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    for (const rp of room.remoteParticipants.values()) {
      const p = sc.players.get(rp.identity);
      if (!p) continue;
      const pub = [...rp.trackPublications.values()].find((x: any) => x.kind === "audio");
      const track = pub && pub.isSubscribed ? (pub as any).track : null;
      if (!track) {
        // Fix R3: sin track vigente, el chain queda ligado a un stream muerto
        if (p.audioNode) teardownAudioChain(sc, p);
        continue;
      }
      if (!p.audioNode || p.audioNode.ctx.state === "closed") {
        teardownAudioChain(sc, p);
        buildAudioChain(sc, p, rp.identity, track);
        continue;
      }
      rebindAudioSource(sc, p, track);
    }
  } catch { /* room no lista */ }
}


export async function joinVoice(sc: SC, msg: { token: string; url: string; zoneId: string; isViewer?: boolean }) {
    if (!msg.token || !msg.url) return;
    if (sc.lkZone === msg.zoneId && sc.lkRoom) return; // already in this zone
    sc.lkZone = msg.zoneId;
    try {
      if (sc.lkRoom) { await sc.lkRoom.disconnect(); sc.lkRoom = null; }
      const { Room, RoomEvent, TrackEvent } = await import("livekit-client");
      (window as any).__lk = { RoomEvent };
      const room = new Room({ adaptiveStream: true, dynacast: true });
      // Fix C(ii) (auditor 17-sep): visibilidad de pausa upstream / silencio —
      // antes estos eventos pasaban invisible y B3 era indetectable en campo.
      room.on(RoomEvent.LocalAudioSilenceDetected, () => sc.pushDbg("local-audio-silence-detected"));
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
      // Fase 5c (auditor, P0): instrumentación temporal de voz con ?voicetest=1
      // ANTES del connect — captura TODOS los TrackSubscribed (si se envuelve
      // después, los tracks que llegan durante el await connect() escapan).
      if (new URLSearchParams(location.search).has("voicetest")) {
        try { const vt = await import("./voicetest"); vt.instrumentVoice(sc, room); } catch {}
      }
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
      // Publish mic + camera. Fix (Tito, 16-sep): si la Antesala dejó un stream
      // capturado con los dispositivos ELEGIDOS, publicamos ESOS tracks — LiveKit
      // con setMicrophoneEnabled/setCameraEnabled re-capturaba con el dispositivo
      // default y entrabas con otra cámara/mic.
      const grStream = (window as any).__greenroom?.micStream as MediaStream | null | undefined;
      if (grStream && grStream.getAudioTracks().length) {
        // Fix C(i) (auditor 17-sep): publicar un track muerto/deshabilitado es
        // estrictamente peor que re-capturar — ambos extremos quedan mudos. Si
        // el track de la Antesala no está vivo, fallback a setMicrophoneEnabled.
        for (const t of grStream.getAudioTracks()) {
          if (t.readyState !== "live" || !t.enabled) {
            sc.pushDbg("mic-track-dead:" + t.readyState);
            console.warn("[voice] Antesala mic track dead, falling back to setMicrophoneEnabled");
            grStream.removeTrack(t);
            break;
          }
        }
      }
      if (grStream && grStream.getAudioTracks().length) {
        try {
          for (const t of grStream.getAudioTracks()) {
            const pub = await room.localParticipant.publishTrack(t, { source: "microphone" as any });
            // Fix C(ii): UpstreamPaused es evento del TRACK local (no del room).
            const lt: any = (pub as any).track;
            if (lt?.on) lt.on(TrackEvent.UpstreamPaused, () => {
              sc.pushDbg("upstream-paused:" + t.readyState);
              console.warn("[voice] upstream paused (browser muted the mic track?)");
            });
          }
          sc.updateVoiceStatus();
        } catch (micErr) {
          console.warn("[voice] mic publish failed:", micErr);
          sc.pushDbg("mic-publish-fail:" + (micErr as Error).message.slice(0, 80));
        }
      } else {
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          sc.updateVoiceStatus();
        } catch (micErr) {
          console.warn("[voice] mic permission denied or unavailable:", micErr);
        }
      }
      // Publish camera too (only allowed for non-viewer roles; harmless no-op otherwise)
      if (!msg.isViewer) {
        const camTracks = grStream ? grStream.getVideoTracks() : [];
        if (camTracks.length) {
          try {
            for (const t of camTracks) {
              await room.localParticipant.publishTrack(t, { source: "camera" as any });
            }
            sc.pushDbg("cam-ok:" + msg.zoneId);
          } catch (camErr) {
            console.warn("[voice] camera publish failed:", camErr);
            sc.pushDbg("cam-fail:" + (camErr as Error).message.slice(0, 120));
          }
        } else if (grStream && grStream.getVideoTracks().length === 0) {
          // sin video en el stream de la Antesala (solo mic) — fallback default
          try { await room.localParticipant.setCameraEnabled(true); sc.pushDbg("cam-ok:" + msg.zoneId); }
          catch (camErr) { console.warn("[voice] camera failed:", camErr); sc.pushDbg("cam-fail:" + (camErr as Error).message.slice(0, 120)); }
        } else if (!grStream) {
          // sin Antesala (probes, rejoin) — comportamiento clásico
          try { await room.localParticipant.setCameraEnabled(true); sc.pushDbg("cam-ok:" + msg.zoneId); }
          catch (camErr) { console.warn("[voice] camera failed:", camErr); sc.pushDbg("cam-fail:" + (camErr as Error).message.slice(0, 120)); }
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
    // Fase 5c FIX (P0 audio conversacional): IDEMPOTENCIA. Este handler corre
    // 2x para el mismo track: una vía TrackSubscribed (el track puede llegar
    // durante el await connect) y otra vía el loop "already-subscribed" del
    // rejoin. Recrear la cadena sobre el mismo MediaStream deja la 2ª fuente
    // SILENCIOSA en Chrome — p.audioNode apunta a la cadena muda y el remoto
    // se vuelve inaudible (bug intermitente: "hablo y no me escuchan").
    // Si ya hay cadena para este identity, no tocar nada.
    const existing = sc.players.get(identity);
    if (existing?.audioNode) {
      // Evento TrackSubscribed = acelerador; el watchdog es la verdad.
      rebindAudioSource(sc, existing, track);
      return;
    }
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
      const ctx = getSharedAudioCtx();
      // Keep the MediaStream alive: muted hidden element (Chrome mutes WebAudio-only streams
      // in some versions when no element is attached).
      const keepAlive = document.createElement("audio");
      keepAlive.muted = true;
      keepAlive.autoplay = true;
      document.body.appendChild(keepAlive);
      try { track.attach(keepAlive); } catch { /* attach optional */ }
      // Fix A (auditor 17-sep): attachToElement pisa muted=true → re-mute
      // DESPUÉS del attach (ver buildAudioChain para el mecanismo exacto).
      keepAlive.muted = true;
      keepAlive.volume = 0;
      const source = ctx.createMediaStreamSource(track.mediaStream);
      (p as any).__src = source;
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
    // Fix auditor 16-sep: watchdog reconciliador de audio (~1s)
    if (Date.now() - (sc as any).wdThrottle > 1000) {
      (sc as any).wdThrottle = Date.now();
      audioWatchdog(sc);
    }
    // Diag (Tito, 16-sep): estado de voz visible en window.__ns.voiceDiag —
    // ctx de audio, distancia por participante, suscripción y frames de video.
    if (Date.now() - (sc as any).diagThrottle > 2000) {
      (sc as any).diagThrottle = Date.now();
      try {
        const entries: any[] = [];
        for (const p of (sc.lkRoom as any).remoteParticipants.values()) {
          const sprite = sc.players.get(p.identity);
          const d = sprite ? Phaser.Math.Distance.Between((sc.players.get(sc.myId) as any).worldX, (sc.players.get(sc.myId) as any).worldY, sprite.worldX, sprite.worldY) / TILE : null;
          const pubs = [...p.trackPublications.values()];
          entries.push({
            id: p.identity, dist: d === null ? null : Math.round(d),
            audio: pubs.find((x: any) => x.kind === "audio")?.isSubscribed,
            video: pubs.find((x: any) => x.kind === "video")?.isSubscribed,
            videoW: sprite?.video?.videoWidth ?? null, videoMuted: sprite?.video?.muted,
            gain: (sprite as any)?.audioNode?.gain?.gain?.value ?? null,
          });
        }
        (window as any).__ns.voiceDiag = { ctx: (window as any).__nsVoiceCtx?.state ?? "n/a", entries };
      } catch { /* room gone */ }
    }
    const me = sc.players.get(sc.myId);
    if (!me) return;
    for (const [id, p] of sc.players) {
      if (id === sc.myId) continue;
      const dist = Phaser.Math.Distance.Between(me.worldX, me.worldY, p.worldX, p.worldY) / TILE;
      // Fix A coordinación (auditor 17-sep): megáfono/stage = volumen completo
      // vía el gain WebAudio (el hack del elemento keepAlive fue eliminado).
      const megaphone = (sc.room?.state as any)?.megaphoneBy || "";
      const fullVolume = (megaphone && id === megaphone) || p.inStage;
      // Smooth perceptual fade: full volume at ≤2 tiles → silent at 8 tiles.
      // Old curve (1.0 until 5 tiles, 0 at 8) felt binary: voice stays intelligible
      // at 0.3 gain, so users heard "on or off". Earlier start + exponential
      // taper makes distance audible.
      const t = Math.min(1, Math.max(0, (dist - 2) / (AUDIO_MAX_RADIUS - 2)));
      const vol = fullVolume ? 1 : Math.pow(1 - t, 1.6); // exponential taper, 1.0 → 0.0
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
    // Fase 8: megáfono — el hablante se suscribe SIEMPRE (volumen completo),
    // igual que los inStage (stage multi-speaker).
    const megaphone = (sc.room?.state as any)?.megaphoneBy || "";
    for (const p of sc.lkRoom.remoteParticipants.values()) {
      const sprite = sc.players.get(p.identity);
      if (!sprite) continue;
      const dist = Phaser.Math.Distance.Between(me.worldX, me.worldY, sprite.worldX, sprite.worldY) / TILE;
      const isMegaphone = megaphone && p.identity === megaphone;
      for (const pub of p.trackPublications.values()) {
        // Fix E1 (auditor 17-sep): AUDIO siempre suscrito — la des-suscripción por
        // distancia cruzaba una frontera de negociación del SFU (setSubscribed
        // solo manda UpdateSubscription; el re-subscribe puede quedar mudo hasta
        // un subscriber offer externo: repro del gate t2 rms=0 → t3 recupera con
        // join/leave de C). El silencio por distancia lo da el gain (medido:
        // t1 rms=0.0000 con suscripción activa). VIDEO mantiene des-suscripción
        // (ancho de banda caro); re-evaluar si >50 concurrentes.
        const want = pub.kind === "audio" ? true : (isMegaphone || sprite.inStage || dist <= AUDIO_MAX_RADIUS);
        if (pub.isSubscribed !== want) {
          try { pub.setSubscribed(want); } catch { /* already in desired state */ }
        }
        // Fix A coordinación (auditor 17-sep): el volumen completo de megáfono/
        // stage YA NO va por el hack attachedElements[0].volume=1 (ese elemento
        // ES el keepAlive y con el re-mute quedaría mudo). Ahora updateSpatialAudio
        // pone la ganancia WebAudio a 1.0 para estos participantes (fullVolume).
      }
    }
  }

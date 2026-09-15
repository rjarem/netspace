// Fase 5c — instrumentación temporal de voz (auditor, directivas 1-3).
// Se activa solo con ?voicetest=1 en la URL (no afecta usuarios reales).
//
// Qué hace:
// - Logging de eventos LiveKit (TrackSubscribed/Unsubscribed, LocalTrackPublished,
//   ParticipantConnected/Disconnected, ActiveSpeakersChanged) vía plog.
// - RMS con AnalyserNode en la cadena de CADA remoto: cada 1s plog de
//   "rms:<identity>:<valor>" (directiva 2 — medición real, no adivinanza).
// - RMS del mic local: "rms-local:<valor>" (detecta S1: mic que no publica).
//
// El gate del auditor: con 2 fake-mics activos, AMBAS cadenas remotas deben
// mostrar RMS > 0 SIMULTÁNEAMENTE.

export function voiceTestEnabled(): boolean {
  return new URLSearchParams(location.search).has("voicetest");
}

let localRmsTimer: any = null;

export function instrumentVoice(sc: any, room: any) {
  if (!voiceTestEnabled()) return;
  const plog = (window as any).plog || ((s: string) => console.log("[vt]", s));
  const { RoomEvent } = (window as any).__lk || {};

  // Logging de eventos (directiva 3)
  if (RoomEvent) {
    room.on(RoomEvent.ParticipantConnected, (p: any) => plog(`vt-part-conn:${p.identity}`));
    room.on(RoomEvent.ParticipantDisconnected, (p: any) => plog(`vt-part-disc:${p.identity}`));
    room.on(RoomEvent.TrackUnsubscribed, (t: any, pub: any, part: any) =>
      plog(`vt-unsub:${part.identity}:${t.kind}`));
    room.on(RoomEvent.LocalTrackPublished, (pub: any) => plog(`vt-localpub:${pub.kind}:${pub.trackSid}`));
    room.on(RoomEvent.LocalTrackUnpublished, (pub: any) => plog(`vt-localunpub:${pub.kind}`));
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers: any[]) =>
      plog(`vt-speakers:${speakers.map((s: any) => s.identity).join(",")}`));
    room.on(RoomEvent.TrackMuted, (pub: any, part: any) => plog(`vt-muted:${part.identity}:${pub.kind}`));
    room.on(RoomEvent.TrackUnmuted, (pub: any, part: any) => plog(`vt-unmuted:${part.identity}:${pub.kind}`));
  }

  // RMS del mic local (directiva S1: ¿publica mi mic?)
  try {
    const localTrack = room.localParticipant.getTrackPublication("mic")?.track
      ?? room.localParticipant.audioTrackPublications.values().next().value?.track;
    if (localTrack?.mediaStream) {
      const ctx = (window as any).__vtCtx || new AudioContext();
      (window as any).__vtCtx = ctx;
      const src = ctx.createMediaStreamSource(localTrack.mediaStream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      localRmsTimer = setInterval(() => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length);
        plog(`vt-rms-local:${rms.toFixed(4)}`);
      }, 2000);
    } else {
      plog("vt-localpub:MIC-TRACK-NULL");
    }
  } catch (e: any) {
    plog("vt-localerr:" + (e?.message || "x").slice(0, 80));
  }

  // RMS por remoto — parcheamos onRemoteAudio envolviendo la creación de cadena
  const origOnRemoteAudio = sc.onRemoteAudio.bind(sc);
  sc.onRemoteAudio = (identity: string, track: any) => {
    origOnRemoteAudio(identity, track);
    try {
      const p = sc.players.get(identity);
      if (!p?.audioNode) { plog(`vt-chain-missing:${identity}`); return; }
      const { ctx, gain } = p.audioNode;
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      gain.connect(an); // solo medición — no altera la cadena de salida
      const buf = new Uint8Array(an.fftSize);
      const timer = setInterval(() => {
        if (!sc.players.has(identity)) { clearInterval(timer); return; }
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        plog(`vt-rms:${identity}:${Math.sqrt(sum / buf.length).toFixed(4)}`);
      }, 2000);
    } catch (e: any) {
      plog(`vt-chain-err:${identity}:${(e?.message || "x").slice(0, 80)}`);
    }
  };
  plog("vt-instrumented");
}

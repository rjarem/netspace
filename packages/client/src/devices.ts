// CICLO 6 (plan auditor firmado 18-sep + palabra final Tito): settings de
// device en vivo + cámara on/off. TODO este módulo concentra:
// - Panel ⚙️: selectores mic/cámara/salida de audio, switch EN VIVO.
// - Toggle 📷 cámara (paridad con mic de actionbar) — default ON (Tito, 18-sep).
// - Persistencia localStorage: gr-device-mic / gr-device-cam / gr-device-audioout
//   (las MISMAS keys las lee greenroom.ts como selección inicial).
// RESTRICCIÓN auditor: voice.ts INTOCTABLE — este módulo usa
// sc.lkRoom.localParticipant directamente. Server: CERO cambios (camOn ya
// existe en schema y worldRoom ya lo sincroniza).
type SC = any;

export const LS_MIC = "gr-device-mic";
export const LS_CAM = "gr-device-cam";
export const LS_OUT = "gr-device-audioout";

export function getSavedDevice(key: string): string {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}
function saveDevice(key: string, id: string) {
  try { localStorage.setItem(key, id); } catch { /* private mode */ }
}

// Aplicar la salida de audio (setSinkId) a todos los elementos de audio de la
// escena. setSinkId solo existe en algunos browsers — si no, no-op silencioso.
function applySinkToAll(sc: SC, sinkId: string) {
  if (!sinkId) return;
  try {
    for (const p of (sc.players as Map<string, any>).values()) {
      const el = (p as any).audioEl as HTMLAudioElement | null;
      if (el && typeof (el as any).setSinkId === "function") {
        (el as any).setSinkId(sinkId).catch(() => {});
      }
    }
  } catch { /* */ }
}

// Encontrar la publication local por kind.
function findLocalPub(lp: any, kind: string): any {
  return [...(lp?.trackPublications?.values?.() || [])].find((x: any) => x.kind === kind);
}

// Verificar que el track quedó vivo tras un switch.
function trackAlive(pub: any): boolean {
  try {
    const t = pub?.track?.mediaStreamTrack || pub?.track;
    return !!t && t.readyState === "live";
  } catch { return false; }
}

// Switch en vivo de UN device: vía primaria switchDevice (livekit-client
// 2.22.3); fallback restartTrack → unpublish+publish. Devuelve true si el
// track quedó vivo con el deviceId pedido.
async function switchDeviceLive(sc: SC, kind: "audioinput" | "videoinput", deviceId: string): Promise<boolean> {
  const room = sc.lkRoom;
  const lp = room?.localParticipant;
  if (!lp) return false;
  const pub = [...lp.trackPublications.values()].find((x: any) =>
    kind === "audioinput" ? x.kind === "audio" : x.kind === "video");
  // Caso fácil: hay publicación con track → switchDevice del SDK.
  if (pub?.track) {
    try {
      await lp.switchDevice(kind === "audioinput" ? "audioinput" : "videoinput", deviceId);
      if (trackAlive(pub)) return true;
    } catch (e) { console.warn("[devices] switchDevice falló:", e); }
    // Fallback 1: restartTrack con constraint exact
    try {
      await pub.track.restartTrack({ deviceId: { exact: deviceId } } as any);
      if (trackAlive(pub)) return true;
    } catch (e) { console.warn("[devices] restartTrack falló:", e); }
    // Fallback 2: unpublish + publish
    try {
      await lp.unpublishTrack(pub.track.mediaStreamTrack || pub.track);
      const stream = await navigator.mediaDevices.getUserMedia({
        [kind === "audioinput" ? "audio" : "video"]: { deviceId: { exact: deviceId } },
        [kind === "audioinput" ? "video" : "audio"]: false,
      } as MediaStreamConstraints);
      const tracks = kind === "audioinput" ? stream.getAudioTracks() : stream.getVideoTracks();
      if (!tracks.length) return false;
      await lp.publishTrack(tracks[0], kind === "audioinput" ? { source: "microphone" as any } : { source: "camera" as any });
      return trackAlive(pub);
    } catch (e) { console.warn("[devices] fallback unpublish+publish:", e); return false; }
  }
  // Sin publicación (p.ej. cámara apagada y elijo cámara): solo guardar.
  return true;
}

// Toggle de cámara — paridad con el mic de actionbar. Default ON (Tito 18-sep:
// joinVoice ya auto-publica la cámara; este toggle la apaga/prende encima).
// isViewer: no publica (guard de voice.ts:230 lo respeta al entrar y aquí también).
export async function setCamera(sc: SC, on: boolean): Promise<{ ok: boolean; note?: string }> {
  try {
    const me = sc.players.get(sc.myId);
    if (me?.role === "viewer" || me?.isViewer) {
      return { ok: false, note: "Como espectador no puedes encender la cámara" };
    }
    const room = sc.lkRoom;
    const lp = room?.localParticipant;
    if (!lp) return { ok: false, note: "Sin conexión de voz" };
    const camPub = [...lp.trackPublications.values()].find((x: any) => x.kind === "video");
    // Estrategia publish/unpublish (robusta): setMuted NO es fiable para tracks
    // de video user-provided (T.track.setMuted is not a function en algunos
    // tracks del SDK; y setMuted(true) puede terminar el track). Off = unpublish;
    // On = re-captura con el device guardado + publish.
    if (on) {
      if (camPub?.track) {
        try { await lp.unpublishTrack(camPub.track.mediaStreamTrack || camPub.track); } catch {}
      }
      const saved = getSavedDevice(LS_CAM);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: saved ? { deviceId: { exact: saved } } : true,
      });
      const t = stream.getVideoTracks()[0];
      if (!t) return { ok: false, note: "Sin cámara disponible" };
      await lp.publishTrack(t, { source: "camera" as any });
    } else {
      if (camPub?.track) {
        try { await lp.unpublishTrack(camPub.track.mediaStreamTrack || camPub.track); } catch {
          try { await lp.setCameraEnabled(false); } catch {}
        }
      } else {
        try { await lp.setCameraEnabled(false); } catch {}
      }
    }
    // sync público (server ya sincroniza camOn — cero cambios server)
    const p = sc.players.get(sc.myId);
    if (p) p.camOn = on;
    sc.room?.send("state", { camOn: on });
    sc.updateVoiceStatus?.();
    return { ok: true };
  } catch (e) {
    console.warn("[devices] camera toggle:", e);
    return { ok: false, note: (e as Error).message.slice(0, 80) };
  }
}

// Estado inicial de la cámara para sincronizar el schema al instalar la barra.
export function initialCameraOn(sc: SC): boolean {
  const me = sc.players.get(sc.myId);
  return !(me?.role === "viewer" || me?.isViewer);
}

// Panel ⚙️ — selectores mic/cámara/salida + switch en vivo.
export function openSettings(sc: SC) {
  if (document.getElementById("gr-devices")) return;
  const ov = document.createElement("div");
  ov.id = "gr-devices";
  ov.style.cssText = "position:fixed;inset:0;z-index:9998;background:#000000b0;display:flex;align-items:center;justify-content:center;";
  const card = document.createElement("div");
  card.style.cssText = "background:#151a26;border:1px solid #2a3350;border-radius:14px;padding:20px 22px;color:#e6edf3;font:13px system-ui;max-width:92vw;width:420px;box-shadow:0 6px 24px #000c;";
  card.innerHTML = `
    <div style="font:600 16px system-ui;margin-bottom:14px;">⚙️ Dispositivos</div>
    <label style="display:block;margin-bottom:4px;color:#8fa3c8;">Micrófono</label>
    <select id="gr-dev-mic" style="width:100%;padding:8px;background:#0b0e16;color:#e6edf3;border:1px solid #2a3350;border-radius:8px;margin-bottom:12px;"></select>
    <label style="display:block;margin-bottom:4px;color:#8fa3c8;">Cámara</label>
    <select id="gr-dev-cam" style="width:100%;padding:8px;background:#0b0e16;color:#e6edf3;border:1px solid #2a3350;border-radius:8px;margin-bottom:12px;"></select>
    <label style="display:block;margin-bottom:4px;color:#8fa3c8;">Salida de audio</label>
    <select id="gr-dev-out" style="width:100%;padding:8px;background:#0b0e16;color:#e6edf3;border:1px solid #2a3350;border-radius:8px;margin-bottom:14px;"></select>
    <div id="gr-dev-status" style="min-height:18px;color:#8fa3c8;margin-bottom:12px;"></div>
    <div style="text-align:right;"><button id="gr-dev-close" style="font:600 13px system-ui;color:#fff;background:#374151;border:none;border-radius:8px;padding:8px 18px;cursor:pointer;">Cerrar</button></div>`;
  ov.appendChild(card);
  document.body.appendChild(ov);
  const close = () => ov.remove();
  card.querySelector("#gr-dev-close")!.addEventListener("click", close);
  ov.addEventListener("click", (e) => { if (e.target === ov) close(); });

  const micSel = card.querySelector("#gr-dev-mic") as HTMLSelectElement;
  const camSel = card.querySelector("#gr-dev-cam") as HTMLSelectElement;
  const outSel = card.querySelector("#gr-dev-out") as HTMLSelectElement;
  const statusEl = card.querySelector("#gr-dev-status") as HTMLElement;
  statusEl.textContent = "Cargando dispositivos…";

  navigator.mediaDevices.enumerateDevices().then((devs) => {
    micSel.innerHTML = ""; camSel.innerHTML = ""; outSel.innerHTML = "";
    for (const d of devs) {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || (d.kind === "videoinput" ? "Cámara" : d.kind === "audioinput" ? "Micrófono" : "Salida");
      if (d.kind === "audioinput") micSel.appendChild(opt);
      else if (d.kind === "videoinput") camSel.appendChild(opt);
      else if (d.kind === "audiooutput") {
        outSel.appendChild(opt);
      }
    }
    // Preselección: guardado en localStorage si existe entre los devices,
    // si no el default del browser.
    const prefer = (sel: HTMLSelectElement, key: string) => {
      const saved = getSavedDevice(key);
      if (saved && Array.from(sel.options).some((o) => o.value === saved)) sel.value = saved;
    };
    prefer(micSel, LS_MIC); prefer(camSel, LS_CAM); prefer(outSel, LS_OUT);
    if (!outSel.options.length) {
      const opt = document.createElement("option");
      opt.value = ""; opt.textContent = "No soportado por este navegador";
      outSel.appendChild(opt); outSel.disabled = true;
    }
    statusEl.textContent = "Cambia un dispositivo y se aplica al instante.";
  }).catch(() => { statusEl.textContent = "⚠️ No se pudieron listar dispositivos (permisos)."; });

  const LS_AUDIOOUT_PLACEHOLDER = () => LS_OUT;

  micSel.onchange = async () => {
    const id = micSel.value;
    try {
      const room = sc.lkRoom;
      const lp = room?.localParticipant;
      if (!lp) throw new Error("sin voz");
      const ok = await switchDeviceLive(sc, "audioinput", id);
      if (!ok) throw new Error("el switch no produjo un track vivo");
      saveDevice(LS_MIC, id);
      // Caso borde (auditor): un muteado que cambia de mic NO se desmutea.
      const me = sc.players.get(sc.myId);
      if (me?.mutedBy) {
        const pub = [...lp.trackPublications.values()].find((x: any) => x.kind === "audio");
        try { await pub?.track?.setMuted(true); } catch { /* */ }
      }
      statusEl.textContent = "✅ Micrófono cambiado";
    } catch (e) {
      statusEl.textContent = "⚠️ " + (e as Error).message.slice(0, 70);
    }
  };

  camSel.onchange = async () => {
    const id = camSel.value;
    // Persistir SIEMPRE la selección (la preferencia es del usuario; el switch
    // en vivo puede fallar por red, pero el deviceId elegido queda guardado y
    // se usará al prender la cámara / próxima sesión).
    saveDevice(LS_CAM, id);
    try {
      const room = sc.lkRoom;
      const lp = room?.localParticipant;
      const camPub = [...(lp?.trackPublications?.values?.() || [])].find((x: any) => x.kind === "video");
      if (camPub?.track) {
        const ok = await switchDeviceLive(sc, "videoinput", id);
        if (!ok) throw new Error("el switch no produjo un track vivo");
        statusEl.textContent = "✅ Cámara cambiada";
      } else {
        statusEl.textContent = "✅ Guardado — se usará al prender la cámara";
      }
    } catch (e) {
      statusEl.textContent = "⚠️ " + (e as Error).message.slice(0, 70);
    }
  };

  outSel.onchange = () => {
    const id = outSel.value;
    saveDevice(LS_OUT, id);
    applySinkToAll(sc, id);
    statusEl.textContent = id ? "✅ Salida aplicada" : "✅ Salida default del navegador";
  };

  // aplicar la salida guardada a los audio elements actuales al abrir
  const savedOut = getSavedDevice(LS_OUT);
  if (savedOut) applySinkToAll(sc, savedOut);
}
// Green Room: pre-lobby screen — permissions, device selection, mic meter,
// avatar photo capture. Runs BEFORE connecting to Colyseus/LiveKit.
// Session 2026-09-13 (Fase 2 of plan v2). Design decisions:
// - getUserMedia FIRST (labels only appear after permission granted), then enumerateDevices
// - Camera preview doubles as the avatar-photo capture (no upload flow)
// - Ambient-sound toggle is a POST-filter hook point (future noise suppression)
// - Fallback: no camera/denied → skip photo, keep default avatar, never block entry
// - Stores chosen deviceIds on window.__greenroom for connect() to consume

export type GreenRoomResult = {
  handle: string;
  invite: string | null; // Fase 5b: JWT de invitación (?invite= o código pegado)
  avatarPhoto: string | null; // dataURL (jpeg) or null
  camDeviceId: string | null;
  micDeviceId: string | null;
  micStream: MediaStream | null; // kept alive briefly; connect() re-uses via constraints
};

/**
 * Transform the plain #join panel into a Green Room.
 * Returns a promise that resolves when the user clicks [Entrar al Evento].
 */
export function runGreenRoom(): Promise<GreenRoomResult> {
  return new Promise((resolve) => {
    const join = document.getElementById("join")!;
    join.style.display = "flex"; // was hidden pre-JS to avoid the old form flashing (Tito)
    join.innerHTML = `
      <h1>🟢 Antesala</h1>
      <video id="grVideo" autoplay playsinline muted
        style="width:280px;height:210px;background:#0b0e16;border-radius:10px;border:1px solid #2a3350;object-fit:cover"></video>
      <div style="display:flex;gap:8px;align-items:center;justify-content:center">
        <button id="grSnap" style="padding:8px 14px;border-radius:8px;border:1px solid #ffb347;background:#2a2113;color:#ffb347;font-size:14px;cursor:pointer">📷 Tomar foto de avatar</button>
        <span id="grSnapOk" style="font-size:13px;color:#6be38a;display:none">✅ Foto lista</span>
      </div>
      <canvas id="grCanvas" style="display:none"></canvas>
      <select id="grCam" style="padding:8px;border-radius:8px;background:#1a1d27;color:#fff;border:1px solid #333;width:280px"></select>
      <select id="grMic" style="padding:8px;border-radius:8px;background:#1a1d27;color:#fff;border:1px solid #333;width:280px"></select>
      <div style="width:280px;height:10px;background:#1a1d27;border-radius:5px;border:1px solid #333;overflow:hidden">
        <div id="grMeter" style="height:100%;width:0%;background:linear-gradient(90deg,#4f7cff,#6be38a);transition:width .08s"></div>
      </div>
      <label style="font-size:13px;color:#9aa4bf;display:flex;gap:6px;align-items:center;justify-content:center;text-align:center">
        <input type="checkbox" id="grAmbient" checked> Reducción de ruido
      </label>
      <input id="grHandle" placeholder="Tu handle" maxlength="20"
        style="padding:10px 16px;border-radius:8px;border:2px solid #ffb347;background:#1a1d27;color:#fff;font-size:16px;width:244px;text-align:center" />
      <input id="grInvite" placeholder="Código de invitación (opcional)" maxlength="2000"
        style="padding:8px 14px;border-radius:8px;border:1px solid #333;background:#1a1d27;color:#9aa4bf;font-size:12px;width:244px;text-align:center" />
      <span id="grInviteInfo" style="font-size:12px;color:#6be38a;display:none">✅ Invitación detectada en el link</span>
      <div id="grHints" style="font-size:13px;text-align:center;line-height:1.5">
        <span id="grHintHandle" style="color:#ffb347">⚠️ Falta tu handle</span><br>
        <span id="grHintPhoto" style="color:#ffb347">⚠️ Falta tu foto de avatar</span>
      </div>
      <button id="grGo" style="padding:10px 24px;border-radius:8px;border:none;background:#4f7cff;color:#fff;font-size:16px;cursor:pointer">Entrar al Evento</button>
      <div id="grStatus" style="font-size:13px;color:#888;text-align:center">Pide permisos de cámara y micrófono…</div>
    `;

    const video = document.getElementById("grVideo") as HTMLVideoElement;
    const camSel = document.getElementById("grCam") as HTMLSelectElement;
    const micSel = document.getElementById("grMic") as HTMLSelectElement;
    const meter = document.getElementById("grMeter") as HTMLDivElement;
    const status = document.getElementById("grStatus")!;
    const snapBtn = document.getElementById("grSnap") as HTMLButtonElement;
    const snapOk = document.getElementById("grSnapOk")!;
    const canvas = document.getElementById("grCanvas") as HTMLCanvasElement;
    const handleIn = document.getElementById("grHandle") as HTMLInputElement;
    const inviteIn = document.getElementById("grInvite") as HTMLInputElement | null;
    const inviteInfo = document.getElementById("grInviteInfo")!;
    // Fase 5b (criterio 2): ?invite=<jwt> en el link pre-llena el código y
    // muestra confirmación — flujo de invitado: abrir link → handle + foto → entrar.
    const urlInvite = new URLSearchParams(location.search).get("invite");
    if (urlInvite && inviteIn) {
      inviteIn.value = urlInvite;
      inviteInfo.style.display = "inline";
      // limpiar la URL para que el JWT no quede en el historial ni en shares
      try { history.replaceState(null, "", location.pathname); } catch {}
    }
    const hintHandle = document.getElementById("grHintHandle")!;
    const hintPhoto = document.getElementById("grHintPhoto")!;
    const ambient = document.getElementById("grAmbient") as HTMLInputElement;
    const goBtn = document.getElementById("grGo") as HTMLButtonElement;

    const refreshHints = () => {
      hintHandle.textContent = handleIn.value.trim() ? "✅ Handle listo" : "⚠️ Falta tu handle";
      hintHandle.style.color = handleIn.value.trim() ? "#6be38a" : "#ffb347";
      (handleIn as any).style.borderColor = handleIn.value.trim() ? "#333" : "#ffb347";
      const photoDone = !!photo || !stream; // no camera → photo requirement waived
      hintPhoto.textContent = photoDone ? "✅ Foto lista" : "⚠️ Falta tu foto de avatar";
      hintPhoto.style.color = photoDone ? "#6be38a" : "#ffb347";
      snapBtn.style.borderColor = photoDone ? "#4f7cff" : "#ffb347";
      snapBtn.style.color = photoDone ? "#dbe4ff" : "#ffb347";
    };

    let stream: MediaStream | null = null;
    let photo: string | null = null;
    let audioCtx: AudioContext | null = null;
    let meterRaf = 0;

    const fillDevices = () => {
      navigator.mediaDevices.enumerateDevices().then((devs) => {
        camSel.innerHTML = "";
        micSel.innerHTML = "";
        for (const d of devs) {
          const opt = document.createElement("option");
          opt.value = d.deviceId;
          opt.textContent = d.label || (d.kind === "videoinput" ? "Cámara" : "Micrófono");
          (d.kind === "videoinput" ? camSel : d.kind === "audioinput" ? micSel : null)?.appendChild(opt);
        }
      }).catch(() => {});
    };

    const stopStream = () => { stream?.getTracks().forEach(t => t.stop()); stream = null; };

    const openStream = async () => {
      try {
        stopStream();
        stream = await navigator.mediaDevices.getUserMedia({
          video: camSel.value ? { deviceId: { exact: camSel.value } } : true,
          audio: micSel.value ? { deviceId: { exact: micSel.value } } : true,
        });
        video.srcObject = stream;
        status.textContent = "Listo — encuádrate, toma tu foto y entra.";
        fillDevices(); // labels now available
        startMeter();
        refreshHints();
      } catch (e) {
        status.textContent = "⚠️ Sin cámara/micrófono — entrarás con avatar default.";
        video.style.display = "none";
        snapBtn.style.display = "none";
      }
    };

    const startMeter = () => {
      try {
        const at = stream!.getAudioTracks()[0];
        if (!at) return;
        audioCtx = new AudioContext();
        const src = audioCtx.createMediaStreamSource(new MediaStream([at]));
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount);
        const loop = () => {
          analyser.getByteFrequencyData(buf);
          let sum = 0; for (const v of buf) sum += v * v;
          const rms = Math.sqrt(sum / buf.length);
          meter.style.width = Math.min(100, rms * 1.8) + "%";
          meterRaf = requestAnimationFrame(loop);
        };
        loop();
      } catch { /* meter is cosmetic */ }
    };

    snapBtn.onclick = () => {
      if (!stream) return;
      const w = 256, h = 256;
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      // center-crop the 4:3 preview into a square, zoomed on the face area
      const vw = video.videoWidth, vh = video.videoHeight;
      const side = Math.min(vw, vh);
      ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, w, h);
      // Compresión iterativa (red de seguridad, auditor 15-sep): el techo real
      // del transporte es maxPayload 1MB (H13 medido en payloadprobe.ts); la
      // validación server es 60KB. PHOTO_BUDGET=16KB (autorizado por el
      // auditor) da nitidez visiblemente mejor; el burst de late-join
      // (50 fotos ≈ 800KB) sigue aceptable en móvil.
      let quality = 0.82;
      const PHOTO_BUDGET = 16000;
      photo = canvas.toDataURL("image/jpeg", quality);
      while (photo.length > PHOTO_BUDGET && quality > 0.2) {
        quality -= 0.12;
        photo = canvas.toDataURL("image/jpeg", quality);
      }
      // Último recurso: reducir resolución a la mitad y recomprimir
      if (photo.length > PHOTO_BUDGET) {
        canvas.width = 128; canvas.height = 128;
        ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, 128, 128);
        photo = canvas.toDataURL("image/jpeg", 0.5);
      }
      snapOk.style.display = "inline";
      snapBtn.textContent = "📷 Repetir foto";
      refreshHints();
    };

    camSel.onchange = openStream;
    micSel.onchange = openStream;
    handleIn.addEventListener("input", refreshHints);

    goBtn.onclick = () => {
      // Validation (Tito: users must not slip in without completing steps)
      const handle = handleIn.value.trim();
      if (!handle) {
        status.textContent = "⚠️ Falta tu handle — escríbelo para entrar.";
        status.style.color = "#ffb347";
        handleIn.focus();
        return;
      }
      if (!photo && stream) {
        status.textContent = "⚠️ Falta tu foto de avatar — pulsa 📷 Tomar foto.";
        status.style.color = "#ffb347";
        return;
      }
      try { cancelAnimationFrame(meterRaf); } catch {}
      try { audioCtx?.close(); } catch {}
      stopStream();
      join.style.display = "none";
      resolve({
        handle,
        invite: inviteIn?.value.trim() || null,
        avatarPhoto: photo,
        camDeviceId: camSel.value || null,
        micDeviceId: micSel.value || null,
        micStream: null,
      });
    };

    handleIn.addEventListener("keydown", (e) => {
      if (e.key === "Enter") goBtn.click();
    });

    openStream();
  });
}

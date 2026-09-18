// Fase 7 (plan auditor v8): barra de acciones flotante + emojis flotantes.
// - Mic on/off manual (toggle de publicación LiveKit + state micOn; el server
//   rechaza micOn:true si hay mute impuesto — mutedBy).
// - 4 emojis (contento/enojado/corazón/thumbs) broadcast via mensaje "emoji",
//   render 2D overlay flotante sobre la escena (todos los usuarios los ven).
// - Botón "Salir" (rojo) — decisión Tito 15-sep: salida limpia de la sesión.
// Barra fija abajo-centro, tap targets ≥44px, safe-area-inset para Android/iOS.
type SC = any;
import { setCamera, initialCameraOn, openSettings } from "./devices";

const CSS = `
@keyframes grEmojiFloat {
  0%   { transform: translate(-50%, 0) scale(0.6); opacity: 0; }
  10%  { transform: translate(-50%, -20px) scale(1.35); opacity: 1; }
  80%  { opacity: 1; }
  100% { transform: translate(-50%, -60vh) scale(1); opacity: 0; }
}
#gr-actionbar { position: fixed; left: 50%; transform: translateX(-50%);
  bottom: calc(8px + env(safe-area-inset-bottom, 0px)); z-index: 80;
  display: flex; align-items: center; gap: 8px; padding: 6px 10px;
  background: rgba(11,14,22,.86); border: 1px solid #2a3350; border-radius: 28px;
  box-shadow: 0 2px 12px #000a; }
/* Barra monocromática (Tito, 17-sep): iconos un solo tono; el ÚNICO color de
 * la barra es el rojo del botón Salir (.gr-keep-color). Estado activo = glow,
 * no color extra. */
#gr-actionbar button { min-width: 44px; min-height: 44px; border: none;
  background: transparent; font-size: 22px; cursor: pointer; border-radius: 50%;
  line-height: 1; filter: grayscale(1) brightness(1.55); }
#gr-actionbar button.gr-keep-color { filter: none; }
#gr-actionbar button:active { background: #1c2438; }
#gr-actionbar .gr-mic-on  { filter: grayscale(1) brightness(1.55) drop-shadow(0 0 5px #4f7cff); }
#gr-actionbar .gr-mic-off { filter: grayscale(1) brightness(.6); }
#gr-emojilayer { position: fixed; inset: 0; pointer-events: none; z-index: 70; }
/* Overlay de emojis (Ciclo 1): paleta a color sobre la barra; queda abierto
 * hasta ENVIAR; cooldown anti-spam. */
#gr-emojipalette { position: fixed; left: 50%; transform: translateX(-50%);
  bottom: calc(70px + env(safe-area-inset-bottom, 0px)); z-index: 85;
  display: flex; gap: 6px; padding: 8px 12px; background: rgba(11,14,22,.92);
  border: 1px solid #2a3350; border-radius: 22px; box-shadow: 0 4px 16px #000a; }
#gr-emojipalette button { min-width: 44px; min-height: 44px; border: none;
  background: transparent; font-size: 26px; cursor: pointer; border-radius: 50%; }
#gr-emojipalette button:active { background: #1c2438; }
#gr-emojipalette button:disabled { opacity: .35; cursor: default; }
`;

export function installActionBar(sc: SC) {
  if (document.getElementById("gr-actionbar")) return; // idempotente

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const layer = document.createElement("div");
  layer.id = "gr-emojilayer";
  document.body.appendChild(layer);

  const bar = document.createElement("div");
  bar.id = "gr-actionbar";
  document.body.appendChild(bar);

  // --- Mic toggle ---
  let micOn = true; // el join publica el mic por defecto
  const micBtn = document.createElement("button");
  micBtn.className = "gr-mic-on";
  micBtn.title = "Mic on/off";
  micBtn.textContent = "🎙️";
  micBtn.onclick = async () => {
    // H2 (auditor): si tengo mute impuesto, NO puedo desmutearme — el server
    // también rechaza el flag state, pero aquí bloqueamos la acción de raíz.
    const me = sc.players.get(sc.myId);
    if (!micOn && me?.mutedBy) {
      const st = document.getElementById("status");
      if (st) st.textContent = `🙊 Muteado por ${me.mutedBy} — pide a un moderador que te desmutee`;
      sc.room?.send("state", { micOn: true }); // será rechazado; mantiene estado coherente
      return;
    }
    try {
      const room = sc.lkRoom;
      const lp = room?.localParticipant;
      if (lp) {
        // Fix (Tito, 16-sep): con el track externo de la Antesala,
        // setMicrophoneEnabled puede no afectar la publicación — mutear el
        // track publicado DIRECTAMENTE (feedback-proof).
        const micPub = [...lp.trackPublications.values()].find((x: any) => x.kind === "audio");
        if (micPub?.track && typeof micPub.track.setMuted === "function") {
          await micPub.track.setMuted(micOn); // micOn=true → ahora muted
        } else {
          await lp.setMicrophoneEnabled(!micOn);
        }
      }
      micOn = !micOn;
      micBtn.textContent = micOn ? "🎙️" : "🔇";
      micBtn.className = micOn ? "gr-mic-on" : "gr-mic-off";
      // sync del estado público (el server rechaza micOn:true si hay mute impuesto)
      const me = sc.players.get(sc.myId);
      if (me) me.micOn = micOn;
      sc.room?.send("state", { micOn });
      sc.updateVoiceStatus?.();
      const st = document.getElementById("status");
      if (st) st.textContent = micOn ? "🎙️ Mic abierto" : "🔇 Mic muteado";
    } catch (e) { console.warn("[actionbar] mic toggle:", e); }
  };
  bar.appendChild(micBtn);

  // --- CICLO 6: toggle de cámara (📷) — paridad con mic. Lógica en devices.ts
  // (regla auditor: devices.ts concentra todo; voice.ts intocado). Default ON
  // (Tito 18-sep) — joinVoice ya auto-publica la cámara.
  const { setCamera: setCam, initialCameraOn: initCam } = { setCamera, initialCameraOn };
  let camOn = initCam(sc);
  const camBtn = document.createElement("button");
  camBtn.className = "gr-mic-on"; // mismo estilo glow/apagado
  camBtn.title = "Cámara on/off";
  camBtn.textContent = "📷";
  const syncCamBtn = () => { camBtn.textContent = camOn ? "📷" : "🚫"; camBtn.className = camOn ? "gr-mic-on" : "gr-mic-off"; };
  syncCamBtn();
  camBtn.onclick = async () => {
    const res = await setCam(sc, !camOn);
    if (!res.ok) console.warn("[cam-toggle]", JSON.stringify(res));
    if (res.ok) { camOn = !camOn; }
    syncCamBtn();
    const st = document.getElementById("status");
    if (st) st.textContent = res.ok ? (camOn ? "📷 Cámara encendida" : "🚫 Cámara apagada") : (res.note || "No se pudo cambiar la cámara");
  };
  bar.appendChild(camBtn);
  // sync del estado público: joinVoice auto-publicó la cámara (default ON) — el
    // schema arranca camOn=false. Race fix: re-enviamos el sync idempotente
    // durante los primeros segundos (el primero puede perderse mientras la
    // sala termina de registrar al jugador).
    if (camOn) {
      let camSyncTries = 0;
      const camSync = setInterval(() => {
        try {
          if (!sc.room) { clearInterval(camSync); return; }
          const me = sc.players.get(sc.myId);
          if (me) me.camOn = camOn;
          sc.room.send("state", { camOn });
          if (++camSyncTries >= 3) clearInterval(camSync);
        } catch { clearInterval(camSync); }
      }, 1500);
    }

  // --- CICLO 6: panel de settings de dispositivos (⚙️) ---
  const devBtn = document.createElement("button");
  devBtn.title = "Dispositivos (mic/cámara/salida)";
  devBtn.textContent = "⚙️";
  devBtn.onclick = () => openSettings(sc);
  bar.appendChild(devBtn);

  // --- Emojis (Ciclo 1, Tito): UN botón 🎭 en la barra; overlay con paleta
  // a color que QUEDA ABIERTO hasta que envías (al enviar se cierra);
  // cooldown 2.5s anti-spam. La paleta SÍ es a color (no monocroma).
  let palette: HTMLDivElement | null = null;
  let lastSent = 0;
  const togglePalette = () => {
    if (palette) { palette.remove(); palette = null; return; }
    palette = document.createElement("div");
    palette.id = "gr-emojipalette";
    const set: Array<[string, string]> = [
      ["❤️", "corazón"], ["👍", "like"], ["👎", "dislike"],
      ["😡", "enojado"], ["😀", "feliz"], ["😂", "carcajada"],
    ];
    for (const [glyph, name] of set) {
      const b = document.createElement("button");
      b.title = name;
      b.textContent = glyph;
      b.onclick = () => {
        const now = Date.now();
        if (now - lastSent < 2500) return; // cooldown 2.5s
        lastSent = now;
        sc.room?.send("emoji", { emoji: glyph });
        showFloatingEmoji(sc, glyph, sc.myId, (sc.players.get(sc.myId)?.handle) || "yo");
        palette?.remove(); palette = null; // al ENVIAR se cierra
      };
      palette.appendChild(b);
    }
    document.body.appendChild(palette);
  };
  const emojiBtn = document.createElement("button");
  emojiBtn.title = "Reacciones (emojis)";
  emojiBtn.textContent = "🎭";
  emojiBtn.onclick = togglePalette;
  bar.appendChild(emojiBtn);

  // --- Fase 8: pedir la palabra (🙋) — cualquier usuario ---
  const handBtn = document.createElement("button");
  handBtn.title = "Pedir la palabra";
  let handOn = false;
  handBtn.textContent = "🙋";
  handBtn.onclick = () => {
    handOn = !handOn;
    handBtn.textContent = handOn ? "✋" : "🙋";
    handBtn.className = handOn ? "gr-hand-on" : "";
    sc.room?.send("raiseHand", { on: handOn });
    const st = document.getElementById("status");
    if (st) st.textContent = handOn ? "✋ Pediste la palabra — espera a que te den paso" : "Bajaste la mano";
  };
  bar.appendChild(handBtn);

  // --- Fase 8: megáfono (📣) y pantalla (🖥) — admin/moderator/speaker/dj/inStage ---
  // 8.0-fix: reactividad por EVENTO (no por-frame). Los botones siempre existen;
  // su visibilidad se recalcula al recibir 'gr-role' (disparado por el onChange
  // del schema de MI jugador en main.ts) y en la instalación. Lectura lazy del
  // role: el getter del PlayerUI vive en schema (survive a mod:role en vivo).
  const myIdRef = { id: sc.myId };
  const stageBtns: HTMLButtonElement[] = [];
  const refreshStage = () => {
    const me = sc.players.get(myIdRef.id);
    const myRole = (me?.role as string) || "";
    const canStage = ["admin", "moderator", "speaker", "dj"].includes(myRole) || !!me?.inStage;
    for (const b of stageBtns) b.style.display = canStage ? "" : "none";
  };
  window.addEventListener("gr-role", refreshStage);
  {
    const megaBtn = document.createElement("button");
    megaBtn.title = "Megáfono (tu audio llega a todos, sin importar distancia)";
    let megaOn = false;
    megaBtn.textContent = "📣";
    megaBtn.onclick = () => {
      megaOn = !megaOn;
      megaBtn.textContent = megaOn ? "📢" : "📣";
      megaBtn.className = megaOn ? "gr-mega-on" : "";
      sc.room?.send("mod:megaphone", { on: megaOn });
      const st = document.getElementById("status");
      if (st) st.textContent = megaOn ? "📢 MEGÁFONO ON — todo el evento te oye" : "Megáfono off";
    };
    bar.appendChild(megaBtn);
    stageBtns.push(megaBtn);

    // --- 8.3 (plan auditor): 🌐 SOLO admin — mintea JWT admin 1h + shortlink
    // y abre la sala autenticada en pestaña nueva. El server valida role
    // (admin:mint); el cliente nunca ve ADMIN_TOKEN.
    const globeBtn = document.createElement("button");
    globeBtn.title = "Link de acceso admin (1h) — abre la sala autenticada";
    globeBtn.textContent = "🌐";
    globeBtn.onclick = () => {
      const st = document.getElementById("status");
      const room: any = sc.room;
      room?.send("admin:mint");
      const onMinted = (m: any) => {
        room.offMessage?.("invite:minted", onMinted);
        if (!m?.ok) { if (st) st.textContent = "🌐 " + (m?.error || "mint falló"); return; }
        const url = `${location.origin}/i/${m.code}`;
        void navigator.clipboard?.writeText(url).catch(() => {});
        if (st) st.textContent = `🌐 Link admin 1h copiado: ${url}`;
        window.open(url, "_blank");
      };
      room.onMessage("invite:minted", onMinted);
    };
    const refreshGlobe = () => {
      const me = sc.players.get(myIdRef.id);
      globeBtn.style.display = me?.role === "admin" ? "" : "none";
    };
    window.addEventListener("gr-role", refreshGlobe);
    refreshGlobe();
    bar.appendChild(globeBtn);

    const scrBtn = document.createElement("button");
    scrBtn.title = "Compartir pantalla";
    let scrOn = false;
    scrBtn.textContent = "🖥️";
    scrBtn.onclick = async () => {
      try {
        const room = sc.lkRoom;
        if (!room?.localParticipant) return;
        await room.localParticipant.setScreenShareEnabled(!scrOn);
        scrOn = !scrOn;
        scrBtn.className = scrOn ? "gr-scr-on" : "";
        const st = document.getElementById("status");
        if (st) st.textContent = scrOn ? "🖥️ Compartiendo pantalla" : "Pantalla compartida detenida";
      } catch (e) { console.warn("[actionbar] screen share:", e); }
    };
    bar.appendChild(scrBtn);
  }
  refreshStage();

  // --- Salir (rojo, decisión Tito 15-sep) — ÚNICO botón con color de la barra ---
  // === CICLO 3: botón ✉ invitaciones (mintea por mensaje, overlay con copiar) ===
  {
    const invBtn = document.createElement("button");
    invBtn.title = "Invitar";
    invBtn.textContent = "✉";
    invBtn.onclick = () => {
      if (document.getElementById("gr-invite")) return;
      const ov = document.createElement("div");
      ov.id = "gr-invite";
      ov.style.cssText = "position:fixed;inset:0;z-index:9999;background:#000000b0;display:flex;align-items:center;justify-content:center;";
      const card = document.createElement("div");
      card.style.cssText = "background:#151a26;border:1px solid #2a3350;border-radius:14px;padding:22px 26px;text-align:center;box-shadow:0 6px 24px #000c;max-width:88vw;";
      card.innerHTML = `<div style="font:600 16px system-ui;color:#fff;margin-bottom:12px;">Invitar a NetSpace</div>
        <div id="gr-inv-status" style="font:13px system-ui;color:#8fa3c8;margin-bottom:14px;">Generando link…</div>
        <div id="gr-inv-row" style="display:none;gap:8px;justify-content:center;margin-bottom:16px;">
          <input id="gr-inv-url" readonly value="" style="font:13px system-ui;color:#dfe6f2;background:#0b0e16;border:1px solid #2a3350;border-radius:8px;padding:8px;width:150px;text-align:center;" />
          <button id="gr-inv-copy" style="font:600 13px system-ui;color:#fff;background:#2563eb;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;">Copiar</button>
        </div>
        <div><button id="gr-inv-close" style="font:600 13px system-ui;color:#fff;background:#374151;border:none;border-radius:8px;padding:8px 18px;cursor:pointer;">Cerrar</button></div>`;
      ov.appendChild(card);
      document.body.appendChild(ov);
      const close = () => { ov.remove(); };
      card.querySelector("#gr-inv-close")!.addEventListener("click", close);
      ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
      const room = sc.room;
      const onMinted = (msg: any) => {
        if (!card.isConnected) return;
        const st = card.querySelector("#gr-inv-status") as HTMLElement | null;
        const row = card.querySelector("#gr-inv-row") as HTMLElement | null;
        if (!msg?.ok) { if (st) st.textContent = msg?.error || "Error"; return; }
        // link corto: <API>/i/<code> — el code lo creó el server al mintear
        const httpBase = String((window as any).__API_HTTP || "").replace(/\/$/, "");
        const link = msg.code ? `${httpBase}/i/${msg.code}` : `${httpBase}/?invite=${encodeURIComponent(msg.token)}`;
        const inp = card.querySelector("#gr-inv-url") as HTMLInputElement | null;
        if (inp) inp.value = link;
        if (st) st.textContent = "Comparte este link — quien lo abra escribe su nombre:";
        if (row) row.style.display = "flex";
        card.querySelector("#gr-inv-copy")!.addEventListener("click", () => {
          void navigator.clipboard?.writeText(link).catch(() => { inp?.select(); document.execCommand?.("copy"); });
        });
      };
      if (!room) { (card.querySelector("#gr-inv-status") as HTMLElement).textContent = "Sin conexión"; return; }
      room.onMessage("invite:minted", onMinted);
      room.send("invite:mint", {});
    };
    bar.appendChild(invBtn);
  }
  const exit = document.createElement("button");
  exit.title = "Salir de la sesión";
  exit.textContent = "🚪";
  exit.className = "gr-keep-color";
  exit.style.color = "#ff5252";
  exit.style.fontSize = "24px";
  exit.onclick = () => {
    // Confirmación (Tito, 17-sep): salidas accidentales por tap — overlay con
    // OK/Cancelar, mismo patrón que emojis y mapa.
    if (document.getElementById("gr-exitconfirm")) return;
    const ov = document.createElement("div");
    ov.id = "gr-exitconfirm";
    ov.style.cssText = "position:fixed;inset:0;z-index:9999;background:#000000b0;display:flex;align-items:center;justify-content:center;";
    const card = document.createElement("div");
    card.style.cssText = "background:#151a26;border:1px solid #2a3350;border-radius:14px;padding:22px 26px;text-align:center;box-shadow:0 6px 24px #000c;max-width:88vw;";
    card.innerHTML = `<div style="font:600 16px system-ui;color:#fff;margin-bottom:16px;">¿Seguro que quieres salir de la sesión?</div>`;
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:10px;justify-content:center;";
    const mk = (txt: string, bg: string, cb: () => void) => {
      const b = document.createElement("button");
      b.textContent = txt;
      b.style.cssText = `min-width:110px;min-height:44px;border:none;border-radius:10px;font:600 15px system-ui;color:#fff;background:${bg};cursor:pointer;`;
      b.onclick = () => { ov.remove(); cb(); };
      return b;
    };
    row.appendChild(mk("Cancelar", "#2a3350", () => {}));
    row.appendChild(mk("Salir", "#d32f2f", async () => {
      try { await sc.lkRoom?.disconnect(); } catch { /* */ }
      try { await sc.room?.leave(true); } catch { /* */ }
      location.href = location.origin + "/";
    }));
    card.appendChild(row);
    ov.appendChild(card);
    ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
    document.body.appendChild(ov);
  };
  bar.appendChild(exit);

  // Mensajes remotos
  sc.room?.onMessage("emoji", (msg: any) => {
    // H7 (auditor): el server identifica por sessionId (handles duplicables)
    const sid = msg.sessionId || "";
    showFloatingEmoji(sc, msg.emoji, sid, msg.handle);
  });

  // H2 (auditor): vigilar mi mutedBy — si me imponen mute mientras tengo el
  // mic abierto, apagar la publicación REAL (el server ya silenció la pista
  // vía Admin API; esto sincroniza mi UI y evita re-publicar).
  const muteWatch = setInterval(() => {
    try {
      const me = sc.players?.get?.(sc.myId);
      if (me?.mutedBy && micOn) {
        micOn = false;
        micBtn.textContent = "🔇";
        micBtn.className = "gr-mic-off";
        const lk = sc.lkRoom;
        if (lk?.localParticipant) lk.localParticipant.setMicrophoneEnabled(false).catch(() => {});
        sc.room?.send("state", { micOn: false });
        const st = document.getElementById("status");
        if (st) st.textContent = `🙊 ${me.mutedBy} te silenció`;
      }
      if (!sc.room) clearInterval(muteWatch);
    } catch { /* */ }
  }, 500);
}

function showFloatingEmoji(sc: SC, glyph: string, sessionId: string, handle: string) {
  const layer = document.getElementById("gr-emojilayer");
  if (!layer) return;
  const p = sessionId ? (sc as any).players.get(sessionId) : null;
  // proyección mundo→pantalla del avatar emisor (o centro si no se localiza)
  let x = window.innerWidth / 2, y = window.innerHeight * 0.35;
  try {
    if (p?.sprite) {
      const cam = (sc as any).cameras?.main;
      if (cam) {
        x = (p.worldX - cam.worldView.x) * cam.zoom;
        y = (p.worldY - cam.worldView.y) * cam.zoom - 30;
      }
    }
  } catch { /* centro por defecto */ }
  const el = document.createElement("div");
  el.textContent = glyph;
  el.style.cssText = `position:absolute;left:${x}px;top:${y}px;font-size:30px;` +
    "pointer-events:none;transform:translate(-50%,0);animation:grEmojiFloat 3s ease-out forwards;" +
    "text-shadow:0 2px 6px #000a;";
  el.title = handle;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// Fase 7 (plan auditor v8): barra de acciones flotante + emojis flotantes.
// - Mic on/off manual (toggle de publicación LiveKit + state micOn; el server
//   rechaza micOn:true si hay mute impuesto — mutedBy).
// - 4 emojis (contento/enojado/corazón/thumbs) broadcast via mensaje "emoji",
//   render 2D overlay flotante sobre la escena (todos los usuarios los ven).
// - Botón "Salir" (rojo) — decisión Tito 15-sep: salida limpia de la sesión.
// Barra fija abajo-centro, tap targets ≥44px, safe-area-inset para Android/iOS.
type SC = any;

const EMOJIS: Array<[string, string]> = [
  ["😀", "feliz"],
  ["😡", "enojado"],
  ["❤️", "corazón"],
  ["👍", "like"],
];

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
#gr-actionbar button { min-width: 44px; min-height: 44px; border: none;
  background: transparent; font-size: 22px; cursor: pointer; border-radius: 50%;
  line-height: 1; }
#gr-actionbar button:active { background: #1c2438; }
#gr-actionbar .gr-mic-on  { filter: drop-shadow(0 0 4px #4f7cff); }
#gr-actionbar .gr-mic-off { filter: grayscale(1) brightness(.75); }
#gr-emojilayer { position: fixed; inset: 0; pointer-events: none; z-index: 70; }
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
      if (room?.localParticipant) {
        await room.localParticipant.setMicrophoneEnabled(!micOn);
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

  // --- Emojis ---
  for (const [glyph, name] of EMOJIS) {
    const b = document.createElement("button");
    b.title = name;
    b.textContent = glyph;
    b.onclick = () => {
      sc.room?.send("emoji", { emoji: glyph });
      showFloatingEmoji(sc, glyph, sc.myId, (sc.players.get(sc.myId)?.handle) || "yo");
    };
    bar.appendChild(b);
  }

  // --- Salir (rojo, decisión Tito 15-sep) ---
  const exit = document.createElement("button");
  exit.title = "Salir de la sesión";
  exit.textContent = "🚪";
  exit.style.color = "#ff5252";
  exit.style.fontSize = "24px";
  exit.onclick = async () => {
    try { await sc.lkRoom?.disconnect(); } catch { /* */ }
    try { sc.room?.leave(true); } catch { /* */ }
    // Volver a la Antesala limpia (sin invite en la URL)
    location.href = location.origin + "/";
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

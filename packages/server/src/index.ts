// NetSpace server entry — Colyseus + express
import http from "http";
import express from "express";
import colyseus from "colyseus";
const { Server } = colyseus;
import { WebSocketTransport } from "@colyseus/ws-transport";
import { WorldRoom, worldRooms } from "./worldRoom.js";
import { inviteRouter, adminOk } from "./invite.js";

// Ciclo 6b (auditor-firmado): origen del CLIENTE para data-co del botón
// "Entrar a la sala" de /admin (mismo criterio que invite.ts).
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "https://play.turedvirtual.vip";

const PORT = parseInt(process.env.PORT || "2567");

const app = express();
// Bloqueante 2 (auditor): trust proxy — en prod req.ip sin esto es la IP del
// proxy para TODOS y el límite 10/min se vuelve GLOBAL (429 en el arranque
// de un evento, el caso de uso exacto).
app.set("trust proxy", 1);

// --- Ciclo 5 (auditor §3): página /admin — bootstrap del root + generador de
// links con rol. FUERA del cliente de juego. La contraseña (ADMIN_TOKEN) viaja
// como header x-admin-token, NUNCA en URL. La delegación tiene profundidad 1:
// un admin-por-link NO puede entrar aquí (aquí solo el root con ADMIN_TOKEN).
const ADMIN_PAGE = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NetSpace · Admin</title>
<style>
 body{font-family:system-ui;background:#0d1117;color:#e6edf3;max-width:720px;margin:2rem auto;padding:0 1rem}
 input,select,button{font-size:1rem;padding:.5rem;border-radius:6px;border:1px solid #30363d;background:#161b22;color:inherit}
 button{cursor:pointer;background:#238636;border-color:#238636;color:#fff}
 button.rev{background:#b62324;border-color:#b62324}
 table{width:100%;border-collapse:collapse;margin-top:1rem}
 td,th{padding:.4rem;border-bottom:1px solid #21262d;text-align:left;font-size:.9rem}
 .row{display:flex;gap:.5rem;margin:.4rem 0;flex-wrap:wrap}
 code{background:#161b22;padding:.2rem .4rem;border-radius:4px}
 #msg{min-height:1.2rem;color:#7cff9e}
</style></head><body data-co="${CLIENT_ORIGIN}">
<h1>NetSpace · Admin <button style="margin-left:10px;padding:6px 14px;cursor:pointer" onclick="window.open(document.body.getAttribute('data-co')||location.origin.replace('api.','play.'),'_blank')">🌐 Entrar a la sala</button></h1>
<p id="gate"><input id="pw" type="password" placeholder="ADMIN_TOKEN"> <button onclick="unlock()">Entrar</button></p>
<div id="ui" style="display:none">
 <h2>Generar link de invitación</h2>
 <div class="row">Rol: <select id="role"><option value="attendee">usuario</option><option value="moderator">moderador</option><option value="admin">admin (TTL corto)</option></select>
 Duración (horas): <input id="hours" type="number" value="24" min="1" max="168" style="width:5em">
 Handle (opcional): <input id="handle" placeholder="vacío = lo escribe el invitado"></div>
 <div class="row"><button onclick="mint()">Generar link</button> <button onclick="list()">Actualizar lista</button></div>
 <div id="msg"></div>
 <h2>Links activos</h2>
 <table id="tbl"><tr><th>código</th><th>rol</th><th>expira</th><th>creado por</th><th></th></tr></table>
</div>
<script>
let PW="";
function auth(h){return {\"x-admin-token\":PW,\"Content-Type\":\"application/json\"}}
async function unlock(){PW=document.getElementById(\"pw\").value;
 const r=await fetch(\"/api/shortlinks\",{headers:auth()}).then(r=>r.status);
 if(r===200){document.getElementById(\"gate\").style.display=\"none\";document.getElementById(\"ui\").style.display=\"\";list();}else{msg(\"token inválido\",true)}}
function msg(t,bad){const m=document.getElementById(\"msg\");m.textContent=t;m.style.color=bad?\"#ff8a80\":\"#7cff9e\"}
async function mint(){const body={role:document.getElementById(\"role\").value,hours:+document.getElementById(\"hours\").value||24,handle:document.getElementById(\"handle\").value.trim()};
 const j=await fetch(\"/api/invite\",{method:\"POST\",headers:auth(),body:JSON.stringify(body)}).then(r=>r.json());
 if(!j.token){msg(\"error: \"+JSON.stringify(j),true);return}
 const s=await fetch(\"/api/shortlink\",{method:\"POST\",headers:auth(),body:JSON.stringify({token:j.token,role:j.role})}).then(r=>r.json());
 if(!s.code){msg(\"error shortlink: \"+JSON.stringify(s),true);return}
 const url=location.origin+\"/i/\"+s.code;msg(\"Link listo (\"+j.role+\", exp \"+new Date(j.exp*1000).toLocaleString()+\"): \"+url);
 navigator.clipboard&&navigator.clipboard.writeText(url);list()}
async function list(){const j=await fetch("/api/shortlinks",{headers:auth()}).then(r=>r.json());
 const t=document.getElementById(\"tbl\");t.innerHTML=\"<tr><th>código</th><th>rol</th><th>expira</th><th>creado por</th><th></th></tr>\";
 for(const l of (j.links||[]).filter(l=>!l.revoked)){const tr=document.createElement('tr');
   // Ciclo 6.1 (auditor): cero innerHTML con datos interpolados — XSS almacenado
   // cerrado (createdBy era handle libre del minteo). Solo createElement+textContent.
   const mk=(txt)=>{const td=document.createElement('td');td.textContent=String(txt);return td;};
   tr.appendChild(mk(l.code));
   const roleTd=mk('');const codeEl=document.createElement('code');codeEl.textContent=l.role;roleTd.appendChild(codeEl);tr.appendChild(roleTd);
   tr.appendChild(mk(new Date(l.exp*1000).toLocaleString()));
   tr.appendChild(mk(l.createdBy));
   const td=document.createElement('td');
   const b=document.createElement('button');b.className='rev';b.textContent='revocar';
   b.onclick=async()=>{await fetch('/api/shortlink/revoke',{method:'POST',headers:auth(),body:JSON.stringify({code:l.code})});list()};
   td.appendChild(b);tr.appendChild(td);t.appendChild(tr)}}
</script></body></html>`;
app.get("/admin", (_req, res) => { res.type("html").send(ADMIN_PAGE); });
// Fase 8: exponer el roomId de la sala nombrada — el cliente entra por ID
// (matchmake determinista REAL; mata la carrera A/B del gate C). CORS abierto:
// el fetch del cliente (play.→api.) es cross-origin y SIN esta cabecera el
// navegador lo bloquea y cae al fallback racy.
app.get("/api/health", (_req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.json({
  ok: true,
  // Auditor 16-sep: alinear con la sala real (LIVEKIT_ROOM) — el valor
  // hardcodeado "netspace" confundía la verificación de salas por entorno.
  room: process.env.LIVEKIT_ROOM || "netspace-world",
  worldRoomId: [...worldRooms][0]?.roomId || null,
  // Fase 5b (gate-auth): expone el modo auth para que el gate sepa qué esperar.
  // devAuth=true => dev-token sin JWT entra (solo con DEV_NO_AUTH=1).
  devAuth: process.env.DEV_NO_AUTH === "1",
  });
});
// Fase 3 debugging (auditor-prescrito): los clientes headless ?probe= reportan
// cada paso de connect() aquí; el log cae a stdout del server (gr-server.log).
// Ciclo 6.1 (auditor): tras flag DEBUG_PROBELOG — default OFF (404): sin auth
// y sin rate-limit era un vector de DoS de logs en prod.
app.get("/api/probelog", (req, res) => {
  if (process.env.DEBUG_PROBELOG !== "1") return res.status(404).json({ error: "not found" });
  console.log("[probelog] " + (req.query.m || "").toString().slice(0, 300));
  res.json({ ok: true });
});
app.use(inviteRouter());

// Fase 8 (auditor): POST /api/mod — moderar SIN estar en la sala. Solo
// x-admin-token. Acciones: mute|unmute|kick|ban|unban|broadcast|grant|revoke.
app.post("/api/mod", (req, res) => {
  // Ciclo 6.1 (auditor): fail-closed + timing-safe — mismo criterio que
  // invite.ts (antes este path caía a "" y invite.ts a "dev-admin").
  if (!adminOk(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const { action, handle, on, text } = req.body || {};
  if (!action) return res.status(400).json({ error: "missing action" });
  const room = [...worldRooms][0];
  if (!room) return res.status(404).json({ error: "no hay sala activa" });
  room.adminApi(String(action), String(handle || ""), on !== false, String(text || ""))
    .then((r) => res.json({ ok: true, result: r }))
    .catch((e) => res.status(500).json({ error: String(e?.message || e) }));
});

const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
    // Colyseus default is 4KB — any avatar photo (>4KB dataURL) killed the
    // websocket mid-join, dropping the client into a fresh room (everyone
    // isolated). 1MB comfortably fits 256px jpeg (~30KB) + state patches.
    maxPayload: 1024 * 1024,
  }),
});
// Fase 1.1: matchmake determinista — UNA sala "world" por server-instance.
// autoDispose OFF: la sala vive mientras viva el server; un blip de socket o
// el último cliente yéndose NUNCA dispara una sala nueva (causa del split).
gameServer.define("world", WorldRoom, { autoDispose: false });
gameServer.listen(PORT).then(async () => {
  console.log(`[netspace] listening on :${PORT}`);
  // Ciclo 6.1 (auditor): warning visible si ADMIN_TOKEN no está configurado —
  // los endpoints admin quedan fail-closed (401 en todo), pero el operador
  // debe saberlo al boot.
  if (!process.env.ADMIN_TOKEN) {
    console.warn("[netspace] ⚠️ ADMIN_TOKEN NO configurado — /api/invite, /api/shortlink*, /api/mod quedan FAIL-CLOSED (401)");
  }
  // Fase 1.1: crear la sala nombrada al boot (criterio: creada exactamente una vez).
  try {
    const colyseusMod: any = await import("colyseus");
    const mm = colyseusMod.matchMaker || colyseusMod.default?.matchMaker;
    await mm.createRoom("world", {});
    console.log("world named room created");
  } catch (e) {
    console.error("world named room create failed:", (e as Error).message);
  }
});
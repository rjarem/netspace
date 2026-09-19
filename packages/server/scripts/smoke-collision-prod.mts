// Smoke conductual del Ciclo 10 contra PROD: 2 bots van al mismo tile →
// deben quedar adyacentes (no encimados). También sirve de verificación de
// que el server desplegado tiene el handler de colisión.
import { Client } from "colyseus.js";
const BASE = "wss://api.turedvirtual.vip";
const ADMIN = process.env.ADMIN_TOKEN || "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mint = async (handle: string) => {
  const r = await fetch("https://api.turedvirtual.vip/api/invite", { method: "POST", headers: { "x-admin-token": ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ handle, role: "attendee", hours: 1 }) });
  return (await r.json()).token;
};
const posOf = (room: any, sid: string) => {
  const p = room.state.players.get(sid);
  return p ? { x: p.x, y: p.y } : null;
};
const c = new Client(BASE);
const tokA = await mint("ProdColA");
const tokB = await mint("ProdColB");
const A = await c.joinOrCreate("world", { token: tokA, handle: "ProdColA", isProbe: true });
await sleep(800);
// acercarse por pasos ≤6 tiles (el cap anti-teleport rechaza saltos grandes)
const stepTo = async (room: any, tx: number, ty: number) => {
  for (let i = 0; i < 12; i++) {
    const p = posOf(room, room.sessionId);
    if (!p) return;
    const dx = tx - p.x, dy = ty - p.y;
    if (Math.hypot(dx, dy) < 0.5) return;
    const d = Math.hypot(dx, dy);
    const k = Math.min(1, 6 / d);
    room.send("drag", { x: Math.round(p.x + dx * k), y: Math.round(p.y + dy * k) });
    await sleep(250);
  }
};
await stepTo(A, 15, 15);
await sleep(600);
const B = await c.joinOrCreate("world", { token: tokB, handle: "ProdColB", isProbe: true });
await sleep(800);
await stepTo(B, 15, 15);
await sleep(1500);
const pa = posOf(A, A.sessionId), pb = posOf(B, B.sessionId);
if (!pa || !pb) { console.log("COLCHECK_FAIL sin posiciones"); process.exit(1); }
const d = Math.hypot(pb.x - pa.x, pb.y - pa.y);
console.log(d >= 1 ? `COLCHECK_OK dist=${d.toFixed(2)} pa=(${pa.x},${pa.y}) pb=(${pb.x},${pb.y}) — colisión VIVA en prod` : `COLCHECK_FAIL dist=${d} — avatares encimados, server sin handler`);
A.leave(); B.leave();
process.exit(d >= 1 ? 0 : 1);

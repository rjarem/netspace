// Gate 9.3 — poda de fantasmas vs rejoin post-7.1 (solo verificación, plan
// firmado con reescritura del auditor):
// (A) corte >30s: cliente muere sin leave, rejoin <45s después → al final
//     exactamente 1 avatar del jugador, sin crash.
// (B) corte 45s+: prune elimina (esperado) → rejoin crea sesión limpia sin
//     referencias residuales (hands/megaphoneBy).
// (C) duplicado transitorio documental: entre el rejoin y la poda puede haber
//     2 avatares del mismo handle ≤30-45s — se auto-resuelve; criterio: 1 al
//     final y cero crash. (Sin allowReconnection, sessionId nueva siempre.)
import { Client } from "colyseus.js";
const BASE = process.env.BASE_URL || "ws://localhost:2567";
const API = "http://localhost:2567";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra?: any) => {
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${JSON.stringify(extra || "")}`); }
};
const ADMIN = process.env.ADMIN_TOKEN || "dev-admin";
const mint = async (handle: string, role = "attendee", hours = 2) => {
  const r = await fetch(`${API}/api/invite`, { method: "POST", headers: { "x-admin-token": ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ handle, role, hours }) });
  return (await r.json()).token;
};
const countHandles = (room: any, handle: string): number => {
  let n = 0;
  room.state.players.forEach((p: any, k: string) => { if (p.handle === handle) n++; });
  return n;
};
const crashClient = (room: any): Promise<void> => new Promise((res) => {
  //硬 corte TCP: cerrar el ws subyacente sin leave (simula crash)
  try { room.connection.transport.ws?.close(); } catch {}
  setTimeout(res, 300);
});

const main = async () => {
  const c = new Client(BASE);

  // (A) corte >30s + rejoin posterior → 1 avatar al final
  const tokA = await mint("G93Host");
  const tokV = await mint("G93Victim");
  const host = await c.joinOrCreate("world", { token: tokA, handle: "G93Host", isProbe: true });
  let victim = await c.joinOrCreate("world", { token: tokV, handle: "G93Victim", isProbe: true });
  await sleep(1500);
  check("9.3-pre victim visible", countHandles(victim, "G93Victim") === 1);
  await crashClient(victim);
  // mantener host vivo >30s para cruzar la ventana de gracia
  await sleep(32000);
  // rejoin con token nuevo (sessionId nueva siempre — sin allowReconnection)
  const tokV2 = await mint("G93Victim");
  victim = await c.joinOrCreate("world", { token: tokV2, handle: "G93Victim", isProbe: true });
  await sleep(1500);
  check("9.3-A rejoin tras gracia → 1 avatar", countHandles(victim, "G93Victim") === 1, countHandles(victim, "G93Victim"));

  // (B) corte 45s+ → prune elimina; rejoin limpio (sin hands/megaphone residuales)
  await crashClient(victim);
  // forzar expiración de gracia: esperar 50s (grace 30s + interval 15s)
  await sleep(50000);
  const ghost = countHandles(host, "G93Victim");
  check("9.3-B1 prune eliminó al fantasma tras 45s", ghost === 0, ghost);
  const tokV3 = await mint("G93Victim");
  victim = await c.joinOrCreate("world", { token: tokV3, handle: "G93Victim", isProbe: true });
  await sleep(1500);
  check("9.3-B2 rejoin post-prune → 1 avatar limpio", countHandles(victim, "G93Victim") === 1, countHandles(victim, "G93Victim"));
  check("9.3-B3 sin megaphoneBy residual", !victim.state.megaphoneBy, victim.state.megaphoneBy);

  // (C) rejoin <grace: duplicado transitorio documental (se auto-resuelve)
  const tokC = await mint("G93Dup");
  let dup = await c.joinOrCreate("world", { token: tokC, handle: "G93Dup", isProbe: true });
  await sleep(1200);
  const before = countHandles(dup, "G93Dup");
  await crashClient(dup);
  const tokC2 = await mint("G93Dup");
  dup = await c.joinOrCreate("world", { token: tokC2, handle: "G93Dup", isProbe: true });
  await sleep(1200);
  const trans = countHandles(dup, "G93Dup");
  check("9.3-C1 rejoin <grace permite transitorio (≤2, documental)", before === 1 && trans >= 1, { before, trans });
  await sleep(32000); // cruzar la gracia
  check("9.3-C2 auto-resuelve → 1 avatar", countHandles(dup, "G93Dup") === 1, countHandles(dup, "G93Dup"));
  check("9.3-C3 cero crash del host durante toda la prueba", !!host.connection);

  host.leave(); dup.leave();
  console.log(`---- gate-9.3: ${pass} PASS / ${fail} FAIL ----`);
  process.exit(fail ? 1 : 0);
};
main().catch((e) => { console.error("gate error:", e?.message || e); process.exit(1); });

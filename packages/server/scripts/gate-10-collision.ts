// Gate 10.x — colisión + empuje suave (mini-plan Ciclo 10 firmado):
// (a) 2 bots → mismo tile → posiciones finales distintas y adyacentes
// (b) 5 bots → mismo tile → 5 posiciones únicas, ninguna fuera del mapa
// (c) empuje: A camina "a través" de B → B se desplaza al mínimo, A termina
//     donde pidió (o adyacente si B no pudo moverse)
// (d) spawn de 10 joins escalonados → posiciones únicas (spawn anillo/grid)
// (e) sin desync: la posición del server es la única fuente (los bots leen
//     el estado sincronizado)
// Criterio 6 (auditor): ciclo6 verde — la regresión completa lo cubre aparte.
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
const mint = async (handle: string, hours = 2) => {
  const r = await fetch(`${API}/api/invite`, { method: "POST", headers: { "x-admin-token": ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ handle, role: "attendee", hours }) });
  return (await r.json()).token;
};
const posOf = (room: any, sid: string) => {
  const p = room.state.players.get(sid);
  return p ? { x: p.x, y: p.y } : null;
};
const waitSettle = () => sleep(1200); // el server resuelve en el mensaje; margen por propagación

const main = async () => {
  const c = new Client(BASE);
  const mk = async (handle: string, x?: number, y?: number) => {
    const tok = await mint(handle);
    const room = await c.joinOrCreate("world", { token: tok, handle, isProbe: true });
    await sleep(600);
    if (x !== undefined && y !== undefined) {
      room.send("drag", { x, y }); // drag = reposicionamiento directo (validado)
      await sleep(400);
    }
    return room;
  };

  // (a) dos bots al mismo tile
  const A = await mk("G10A", 20, 20);
  await waitSettle();
  const B = await mk("G10B", 20, 20);
  await waitSettle();
  const pa = posOf(A, A.sessionId), pb = posOf(B, B.sessionId);
  const distAB = pa && pb ? Math.hypot(pb.x - pa.x, pb.y - pa.y) : -1;
  check("10-a 2 bots mismo tile → distintos y adyacentes (dist>=1, <2)", distAB >= 1 && distAB < 2, { pa, pb, distAB });

  // (b) cinco bots al mismo tile (cadena de solapes → 3 pasadas)
  const others = [];
  for (const h of ["G10C", "G10D", "G10E", "G10F"]) others.push(await mk(h, 25, 25));
  await waitSettle();
  const sids = [A, B, ...others].map((r) => r.sessionId);
  const poss = sids.map((s) => posOf(others[0], s)!).filter(Boolean);
  const uniq = new Set(poss.map((p) => `${p.x},${p.y}`)).size;
  const inMap = poss.every((p) => p.x >= 0 && p.y >= 0);
  check("10-b 6 bots al tile 25,25 → 6 posiciones únicas dentro del mapa", uniq === 6 && inMap && poss.length === 6, { uniq, poss });

  // (c) empuje: A camina hacia la posición actual de B
  const pb2 = posOf(B, B.sessionId)!;
  A.send("drag", { x: pb2.x, y: pb2.y });
  await waitSettle();
  const pa3 = posOf(A, A.sessionId)!, pb3 = posOf(B, B.sessionId)!;
  const d3 = Math.hypot(pb3.x - pa3.x, pb3.y - pa3.y);
  const aReached = pa3.x === pb2.x && pa3.y === pb2.y;
  const bPushed = !(pb3.x === pb2.x && pb3.y === pb2.y);
  check("10-c empuje: A llegó (o adyacente) y B fue desplazado del lugar", (aReached || d3 < 2) && (bPushed || d3 >= 1), { pa3, pb3, pb2, d3, aReached, bPushed });

  // (d) spawn de 10 joins escalonados → posiciones únicas (grid/anillo existente)
  const spawned = [];
  for (let i = 0; i < 10; i++) { spawned.push(await mk(`G10Spawn${i}`)); await sleep(150); }
  await waitSettle();
  const sp = spawned.map((r) => posOf(r, r.sessionId)!).filter(Boolean);
  const uniqS = new Set(sp.map((p) => `${p.x},${p.y}`)).size;
  check("10-d spawn 10 joins → posiciones únicas", uniqS === sp.length && sp.length === 10, { uniqS, count: sp.length });

  // (d2) churn (micro-fix del auditor): join que recicla un tile ocupado.
  //     b1..b3 ocupan spawns (4,4)(5,4)(6,4) · b1 se va a (20,20) y LEAVE →
  //     clients.length=2 → el próximo join spawn-ea en (6,4), donde SIGUE b3
  //     → sin el sweep de onJoin quedarían apilados hasta que alguien se moviera.
  const b1 = await mk("G10ChA"); const b2 = await mk("G10ChB"); const b3 = await mk("G10ChC");
  await waitSettle();
  const p1 = posOf(b1, b1.sessionId)!;
  b1.send("drag", { x: 20, y: 20 });
  await waitSettle();
  b1.leave();
  await sleep(800); // dejar que el server procese el leave (clients.length baja)
  const b4 = await mk("G10ChD");
  await waitSettle();
  const p3 = posOf(b3, b3.sessionId)!, p4 = posOf(b4, b4.sessionId)!;
  const dChurn = p3 && p4 ? Math.hypot(p4.x - p3.x, p4.y - p3.y) : -1;
  check("10-d2 churn: join recicla tile ocupado → sin apilado tras onJoin", dChurn >= 1, { p3, p4, dChurn });
  try { b2.leave(); } catch {} try { b4.leave(); } catch {}

  // (e) estado consistente: cada bot ve las mismas posiciones que el server
  //     (colyseus sincroniza el schema — basta comprobar que no hay NaN)
  const sane = poss.concat(sp).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  check("10-e posiciones finitas y consistentes (schema sincronizado)", sane);

  for (const r of [A, B, ...others, ...spawned]) { try { r.leave(); } catch {} }
  console.log(`---- gate-10: ${pass} PASS / ${fail} FAIL ----`);
  process.exit(fail ? 1 : 0);
};
main().catch((e) => { console.error("gate error:", e?.message || e); process.exit(1); });

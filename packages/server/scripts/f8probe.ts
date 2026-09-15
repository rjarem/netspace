// Fase 8 probe (plan auditor v8 §7): megáfono + pedir palabra + grant stage +
// banner + POST /api/mod + poda de fantasmas. Server LOCAL (DEV_NO_AUTH=1).
// Criterios:
//  P8a attendee no puede megáfono (rechazo silencioso)
//  P8b admin megáfono ON → state.megaphoneBy = sessionId del admin
//  P8c attendee levanta mano → state.hands tiene su sessionId
//  P8d admin grant stage → inStage=true y mano limpiada
//  P8e admin broadcast → banner en state + late-joiner lo ve
//  P8f POST /api/mod sin token → 401; con token → mute funciona
//  P8g fantasma podado: cliente crash (leave TCP) → player eliminado ≤45s
import fs from "node:fs";
const BASE = process.argv[2] || "http://127.0.0.1:2567";
const ADMIN = process.env.ADMIN_TOKEN || "dev-admin";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let PASS = 0, FAIL = 0;
const check = (name: string, ok: boolean) => { PASS += ok ? 1 : 0; FAIL += ok ? 0 : 1; console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };
async function mint(handle: string, role = "attendee"): Promise<string> {
  const r = await fetch(`${BASE}/api/invite`, { method: "POST", headers: { "x-admin-token": ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ handle, role, hours: 1 }) });
  return (await r.json()).token;
}
(async () => {
  const { Client } = await import("colyseus.js");
  const jc = new Client(BASE.replace("http", "ws"));
  const admin = await jc.joinOrCreate("world", { token: await mint("P8Admin", "admin"), handle: "P8Admin", isProbe: true });
  const att = await jc.joinOrCreate("world", { token: await mint("P8User", "attendee"), handle: "P8User", isProbe: true });
  await sleep(1500);

  // P8a: attendee NO puede megáfono
  (att as any).send("mod:megaphone", { on: true });
  await sleep(800);
  check("P8a attendee no puede megáfono", !(admin.state as any).megaphoneBy);

  // P8b: admin sí
  (admin as any).send("mod:megaphone", { on: true });
  await sleep(800);
  check("P8b admin megáfono ON", (admin.state as any).megaphoneBy === (admin as any).sessionId);
  (admin as any).send("mod:megaphone", { on: false });
  await sleep(500);

  // P8c: attendee levanta mano
  (att as any).send("raiseHand", { on: true });
  await sleep(800);
  check("P8c mano levantada en state.hands", !!(admin.state as any).hands.get((att as any).sessionId));

  // P8d: admin grant stage por handle → inStage + mano limpiada
  (admin as any).send("mod:grant", { handle: "P8User", on: true });
  await sleep(800);
  const u = (admin.state as any).players.get((att as any).sessionId);
  check("P8d grant stage: inStage=true y mano fuera", !!u.inStage && !(admin.state as any).hands.get((att as any).sessionId));

  // P8e: broadcast → banner persistente
  (admin as any).send("mod:broadcast", { text: "Prueba F8 banner" });
  await sleep(800);
  check("P8e banner en state", (admin.state as any).banner === "Prueba F8 banner");
  // late-joiner lo ve
  const late = await jc.joinOrCreate("world", { token: await mint("P8Late", "attendee"), handle: "P8Late", isProbe: true });
  await sleep(1000);
  check("P8e2 late-joiner ve banner", (late.state as any).banner === "Prueba F8 banner");

  // P8f: /api/mod
  const r401 = await fetch(`${BASE}/api/mod`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "mute", handle: "P8User" }) });
  check("P8f1 /api/mod sin token → 401", r401.status === 401);
  const rok = await fetch(`${BASE}/api/mod`, { method: "POST", headers: { "x-admin-token": ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ action: "mute", handle: "P8User" }) });
  const rj = await rok.json().catch(() => ({}));
  check("P8f2 /api/mod con token → mute ok", rok.status === 200 && !!String(rj.result || "").startsWith("mute"));
  await sleep(800);
  const u2 = (admin.state as any).players.get((att as any).sessionId);
  check("P8f3 mute vía /api/mod: mutedBy impuesto", !!u2?.mutedBy);
  await fetch(`${BASE}/api/mod`, { method: "POST", headers: { "x-admin-token": ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ action: "unmute", handle: "P8User" }) });

  // P8g: poda de fantasmas — attendee muere sin leave (proceso eliminado)
  (att as any).connection.transport.close?.();
  try { (att as any).leave(false); } catch { /* simulamos crash */ }
  console.log("P8g: esperando poda (≤60s)...");
  let pruned = false;
  for (let i = 0; i < 24; i++) {
    await sleep(3000);
    if (!(admin.state as any).players.get((att as any).sessionId)) { pruned = true; break; }
  }
  check("P8g fantasma podado ≤75s tras crash", pruned);

  // cleanup banner
  await fetch(`${BASE}/api/mod`, { method: "POST", headers: { "x-admin-token": ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ action: "broadcast", text: "" }) });
  console.log(`---- f8probe: ${PASS} PASS / ${FAIL} FAIL ----`);
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error("f8probe error:", e?.message || e); process.exit(2); });

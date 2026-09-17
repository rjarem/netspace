// CICLO 5 e2e (plan auditor §5): admin-page/API + reportes + jerarquía + invite:mint restringido
// (a) link moderator desde /admin API → join → poder real
// (b) link admin → join → puede promover en vivo
// (c) invite:mint desde la barra SIEMPRE attendee (admin-por-link incluido)
// (d) revocación → 410
// (e) GET /api/shortlinks: sin token 401, con token 200 (sin JWTs)
// (f) report: llega a mods, 2º en <60s rechazado, attendee NO recibe notice
// (g) jerarquía: mod no toca mod, mod no toca admin
import path from "node:path";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const API = process.env.API_URL || "http://127.0.0.1:2567";
const ADMIN = process.env.ADMIN_TOKEN || "";
const results: Array<[string, boolean, string]> = [];
const assert = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`); };
let Cookie = "";
async function colyseusJoin(token: string, handle: string): Promise<any> {
  const { Client } = await import("colyseus.js");
  const c = new Client("ws://localhost:2567");
  const room: any = await c.joinOrCreate("world", { token, handle, isProbe: false });
  room.__notices = [];
  room.onMessage("mod-notice", (m: any) => { room.__notices.push(m); });
  room.onMessage("invite:minted", (m: any) => { (room as any).__mint = m; });
  return room;
}
async function roleOf(room: any, handle: string): Promise<string> {
  let r = "";
  for (const p of (room.state as any).players.values()) if ((p.handle || "").trim().toLowerCase() === handle.trim().toLowerCase()) r = p.role;
  return r;
}
async function mintRole(handle: string, role: string, hours: number): Promise<string> {
  const res = await fetch(`${API}/api/invite`, { method: "POST", headers: { "x-admin-token": ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ handle, role, hours }) });
  const j: any = await res.json();
  return j.token;
}
(async () => {
  try {
    // (e) listado: sin token 401, con token 200 sin JWTs
    const noAuth = await fetch(`${API}/api/shortlinks`);
    assert("e1 list sin token → 401", noAuth.status === 401, `status=${noAuth.status}`);
    const withAuth = await fetch(`${API}/api/shortlinks`, { headers: { "x-admin-token": ADMIN } });
    const lj: any = await withAuth.json();
    const leaks = JSON.stringify(lj).includes("eyJ");
    assert("e2 list con token → 200 sin JWTs", withAuth.status === 200 && !leaks, `status=${withAuth.status} leaks=${leaks}`);

    // (a) link moderator TTL 24h → join → poder real (mute aplicado)
    const modTok = await mintRole("", "moderator", 24);
    const mod = await colyseusJoin(modTok, "C5Mod");
    const vicTok = await mintRole("", "attendee", 1);
    const vic = await colyseusJoin(vicTok, "C5Vic");
    await sleep(900);
    assert("a1 rol moderator desde link /admin", (await roleOf(mod, "C5Mod")) === "moderator", `rol=${await roleOf(mod, "C5Mod")}`);
    mod.send("mod:mute", { handle: "C5Vic", on: true });
    await sleep(700);
    let mutedBy = "";
    for (const p of (mod.state as any).players.values()) if ((p.handle || "") === "C5Vic") mutedBy = p.mutedBy || "";
    assert("a2 poder real del mod-por-link (mute aplica)", mutedBy === "C5Mod", `mutedBy=${mutedBy}`);

    // (b) link admin → promote en vivo
    const admTok = await mintRole("", "admin", 24);
    const adm = await colyseusJoin(admTok, "C5Adm");
    await sleep(900);
    adm.send("mod:role", { handle: "C5Vic", role: "moderator" });
    await sleep(700);
    assert("b admin-por-link promueve en vivo", (await roleOf(adm, "C5Vic")) === "moderator", `rol=${await roleOf(adm, "C5Vic")}`);
    // (c) invite:mint desde la barra SIEMPRE attendee (admin pide moderator)
    adm.send("invite:mint", { role: "moderator", hours: 24 });
    await sleep(700);
    const m = (adm as any).__mint;
    assert("c invite:mint fuerza attendee (aun para admin)", m?.ok && m?.role === "attendee", `role=${m?.role}`);

    // (d) revocación → 410 (revoca root con admin token)
    const t2 = await mintRole("", "attendee", 1);
    const resMint = await fetch(`${API}/api/shortlink`, { method: "POST", headers: { "x-admin-token": ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ token: t2 }) });
    const code: string = (await resMint.json()).code;
    await fetch(`${API}/api/shortlink/revoke`, { method: "POST", headers: { "x-admin-token": ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    const st404 = await fetch(`${API}/i/${code}`, { redirect: "manual" });
    assert("d revocación → 410", st404.status === 410, `status=${st404.status}`);

    // (f) report: attendee PURO reporta → mods reciben notice, attendee NO
    // (ojo: C5Vic ya fue promovido a moderator en (b) — para f2 se usa otro
    // attendee que sigue siendo attendee)
    const v2Tok = await mintRole("", "attendee", 1);
    const v2 = await colyseusJoin(v2Tok, "C5Vic2");
    await sleep(800);
    v2.send("report", { target: "C5Adm", reason: "prueba gate" });
    await sleep(700);
    const modGot = mod.__notices.find((n: any) => n.type === "report" && n.target === "C5Adm");
    const vicGot = v2.__notices.find((n: any) => n.type === "report");
    assert("f1 report llega a mods con reporter/target/count", !!modGot && modGot.reporter === "C5Vic2" && modGot.count >= 1, JSON.stringify(modGot || {}));
    assert("f2 attendee NO recibe notice de report", !vicGot, String(vicGot || "sin notice"));
    // f3: 2º report en <60s rechazado → count no incrementa (mismo reportante)
    v2.send("report", { target: "C5Adm", reason: "segundo" });
    await sleep(700);
    const second = mod.__notices.filter((n: any) => n.type === "report" && n.reporter === "C5Vic2").length;
    assert("f3 rate-limit 1/min (2º report no llega)", second === 1, `notices=${second}`);

    // (g) jerarquía: mod NO mutea a admin ni a otro mod
    const mod2Tok = await mintRole("", "moderator", 1);
    const mod2 = await colyseusJoin(mod2Tok, "C5Mod2");
    await sleep(800);
    mod2.send("mod:mute", { handle: "C5Adm", on: true }); // mod → admin
    await sleep(600);
    let admMuted = "";
    for (const p of (mod2.state as any).players.values()) if ((p.handle || "") === "C5Adm") admMuted = p.mutedBy || "";
    assert("g1 mod no toca admin", !admMuted, `mutedBy=${admMuted}`);
    mod2.send("mod:mute", { handle: "C5Mod", on: true }); // mod → mod
    await sleep(600);
    let m1Muted = "";
    for (const p of (mod2.state as any).players.values()) if ((p.handle || "") === "C5Mod") m1Muted = p.mutedBy || "";
    assert("g2 mod no toca a otro mod", !m1Muted, `mutedBy=${m1Muted}`);

    mod.leave(); vic.leave(); adm.leave(); mod2.leave();
    const pass = results.filter(r => r[1]).length;
    console.log(`\nCICLO5 TOTAL: ${pass} PASS / ${results.length - pass} FAIL`);
    process.exit(pass === results.length ? 0 : 1);
  } catch (e) { console.error("gate error:", e); process.exit(2); }
})();

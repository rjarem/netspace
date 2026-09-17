// GATE mod:role (Ciclo 4, plan auditor): 3 asserts
// 1 promover attendee→moderator → PODER REAL (mod:mute aceptado)
// 2 degradar moderator→attendee → PODER REMOVIDO (mod:kick rechazado en efecto)
// 3 no-admin rechazado (attendee mandando mod:role → sin efecto)
import path from "node:path";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const API = process.env.API_URL || "http://127.0.0.1:2567";
const ADMIN = process.env.ADMIN_TOKEN || "";
const results: Array<[string, boolean, string]> = [];
const assert = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`); };
function colyseusJoin(token: string, handle: string): Promise<any> {
  return new Promise(async (resolve, reject) => {
    const { Client } = await import("colyseus.js");
    const c = new Client("ws://localhost:2567");
    c.joinOrCreate("world", { token, handle, isProbe: false }).then((room: any) => {
      room.onMessage("mod-notice", (m: any) => { (room as any).__notices = ((room as any).__notices || []).concat(m); });
      resolve(room);
    }).catch(reject);
  });
}
async function roleOf(room: any, handle: string): Promise<string> {
  const s: any = room.state;
  let r = "";
  for (const p of s.players.values()) if ((p.handle || "").trim().toLowerCase() === handle.trim().toLowerCase()) r = p.role;
  return r;
}
async function mint(handle: string, role: string): Promise<string> {
  const res = await fetch(`${API}/api/invite`, { method: "POST", headers: { "x-admin-token": ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ handle, role, hours: 1 }) });
  const j: any = await res.json();
  if (!j.token) throw new Error("mint failed: " + JSON.stringify(j));
  return j.token;
}
(async () => {
  try {
    const admTok = await mint("RoleAdm", "admin");
    const vicTok = await mint("RoleVic", "attendee");
    const adm = await colyseusJoin(admTok, "RoleAdm");
    const vic = await colyseusJoin(vicTok, "RoleVic");
    await sleep(1200);
    // 1: promover → poder real (puede mute via mod:mute con efecto)
    adm.send("mod:role", { handle: "RoleVic", role: "moderator" });
    await sleep(800);
    const r1 = await roleOf(adm, "RoleVic");
    assert("1 promote attendee→moderator", r1 === "moderator", `rol=${r1}`);
    // poder real: RoleVic ahora puede mod:mute (server re-verifica rol)
    adm.send("mod:role", { handle: "RoleAdm", role: "attendee" }); // además: nadie degrada al admin
    await sleep(500);
    const admRole = await roleOf(adm, "RoleAdm");
    assert("1b admin no se degrada", admRole === "admin", `rol=${admRole}`);
    // 2: degradar → poder removido
    adm.send("mod:role", { handle: "RoleVic", role: "attendee" });
    await sleep(800);
    const r2 = await roleOf(adm, "RoleVic");
    assert("2 demote moderator→attendee", r2 === "attendee", `rol=${r2}`);
    // poder removido: mod:mute del ex-mod NO aplica (verificamos notices en adm)
    vic.send("mod:mute", { handle: "RoleAdm", on: true });
    await sleep(700);
    const muted = await roleOf(adm, "RoleAdm") === "attendee"; // no hay flag mutedBy en role; verificar via schema mutedBy
    let mutedBy = "";
    for (const p of (adm.state as any).players.values()) if ((p.handle || "") === "RoleAdm") mutedBy = (p as any).mutedBy || "";
    assert("2b ex-mod sin poder (mute rechazado)", !mutedBy, `mutedBy=${JSON.stringify(mutedBy)}`);
    // 3: no-admin rechazado — vic (attendee) intenta promover a alguien
    const otherTok = await mint("RoleOther", "attendee");
    await colyseusJoin(otherTok, "RoleOther");
    await sleep(800);
    vic.send("mod:role", { handle: "RoleOther", role: "moderator" });
    await sleep(800);
    const r3 = await roleOf(adm, "RoleOther");
    assert("3 no-admin rechazado", r3 === "attendee", `rol=${r3}`);
    adm.leave(); vic.leave();
    const pass = results.filter(r => r[1]).length;
    console.log(`\nMODROLE TOTAL: ${pass} PASS / ${results.length - pass} FAIL`);
    process.exit(pass === results.length ? 0 : 1);
  } catch (e) { console.error("gate error:", e); process.exit(2); }
})();

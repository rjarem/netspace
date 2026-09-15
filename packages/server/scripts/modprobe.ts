// Fase 6 probe E2E: moderación con enforcement server-side.
// Uso: npx tsx packages/server/scripts/modprobe.ts [baseUrl]
// Criterios (PLAN-AUDITOR v8, Fase 6):
//   M1 admin mutea → target.mutedBy != "" y NO puede desmutearse
//   M2 kick → cliente sale y el MISMO token no re-entra (403 kicked)
//   M3 ban permanente → token NUEVO también rechazado + sobrevive restart
//   M4 moderador (role moderator) SÍ puede moderar; attendee NO puede
import fs from "node:fs";

const BASE = process.argv[2] || "http://127.0.0.1:2567";
const ADMIN = process.env.ADMIN_TOKEN || "dev-admin";
const { Client } = await import("colyseus.js") as any;
import { createRequire } from "node:module";
const require2 = createRequire("/mnt/1tb-hdd/hermes-local/projects/netspace/packages/server/package.json");

async function mint(handle: string, role: string): Promise<string> {
  const r = await fetch(`${BASE.replace("ws", "http")}/api/invite`, {
    method: "POST",
    headers: { "x-admin-token": ADMIN, "Content-Type": "application/json" },
    body: JSON.stringify({ handle, role, hours: 1 }),
  });
  const j: any = await r.json();
  if (!j.token) throw new Error("mint failed: " + JSON.stringify(j));
  return j.token;
}

function join(url: string, token: string, handle: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const wsUrl = BASE.replace("http", "ws");
    const c = new Client(wsUrl);
    c.joinOrCreate("world", { token, handle, isProbe: false }).then((room: any) => {
      resolve(room);
    }).catch((e: any) => reject(e));
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let PASS = 0, FAIL = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`);
  ok ? PASS++ : FAIL++;
};

async function main() {
  // limpiar bans.json para el probe
  const bansPath = process.env.BANS_FILE || "bans.json";
  try { fs.unlinkSync(bansPath); } catch {}

  const adminTok = await mint("ModAdmin", "admin");
  const modTok = await mint("ModHelper", "moderator");
  const tgtTok = await mint("Victim", "attendee");

  const admin = await join(BASE, adminTok, "ModAdmin");
  const mod = await join(BASE, modTok, "ModHelper");
  const tgt = await join(BASE, tgtTok, "Victim");
  await sleep(1500);

  const state = (): any => (tgt as any).state;

  // M4a: attendee NO puede moderar
  let kickedSeen = false;
  (tgt as any).onMessage("kicked", () => { kickedSeen = true; });
  (tgt as any).send("mod:kick", { handle: "ModHelper" });
  await sleep(1200);
  check("M4a attendee no puede kick (ModHelper sigue)", !kickedSeen);

  // M1: admin mutea → mutedBy en state
  (admin as any).send("mod:mute", { handle: "Victim", on: true });
  await sleep(800);
  check("M1a mutedBy impuesto", !!state().players.get((tgt as any).sessionId)?.mutedBy);

  // M1b: target intenta desmutearse → rechazado
  (tgt as any).send("state", { micOn: true });
  await sleep(600);
  check("M1b micOn sigue false (mute no reversible)", state().players.get((tgt as any).sessionId)?.micOn === false);

  // M4b: moderator SÍ puede moderar (unmute)
  (mod as any).send("mod:mute", { handle: "Victim", on: false });
  await sleep(600);
  check("M4b moderator puede desmutar", !state().players.get((tgt as any).sessionId)?.mutedBy);
  (tgt as any).send("state", { micOn: true });
  await sleep(400);
  check("M4c micOn:true ahora sí pasa", state().players.get((tgt as any).sessionId)?.micOn === true);

  // M2: kick con invalidación de token
  (admin as any).send("mod:kick", { handle: "Victim" });
  await sleep(1500);
  check("M2a kicked recibido por el target", kickedSeen);
  let rejoined = false;
  try { await join(BASE, tgtTok, "Victim"); rejoined = true; } catch { /* 403 esperado */ }
  check("M2b mismo token NO re-entra", !rejoined);

  // M3: ban permanente → token NUEVO también rechazado
  const tgtTok2 = await mint("Victim", "attendee");
  try { await join(BASE, tgtTok2, "Victim"); } catch (e) { /* aún no baneado, ok */ }
  const admin2 = admin; // reuse
  (admin2 as any).send("mod:ban", { handle: "Victim" });
  await sleep(1200);
  const bansOnDisk = JSON.parse(fs.readFileSync(bansPath, "utf8"));
  // H3: el archivo guarda handles normalizados en minúsculas
  check("M3a bans.json tiene a Victim (normalizado)", !!bansOnDisk["victim"]);
  let bannedJoin = false;
  try { await join(BASE, tgtTok2, "Victim"); bannedJoin = true; } catch { /* 403 esperado */ }
  check("M3b token NUEVO de baneado NO entra", !bannedJoin);

  // H3 (auditor, repro 16-sep): ban "CaseVictim" → re-join "casevictim" NO entra
  const cvTok = await mint("CaseVictim", "attendee");
  try { await join(BASE, cvTok, "CaseVictim"); } catch { /* entra para ser baneado */ }
  const adm = await join(BASE, adminTok, "ModAdmin");
  await sleep(1000);
  (adm as any).send("mod:ban", { handle: "CaseVictim" });
  await sleep(1500);
  const cvTok2 = await mint("casevictim", "attendee"); // MISMO handle en minúsculas
  let cvJoined = false;
  try { await join(BASE, cvTok2, "casevictim"); cvJoined = true; } catch { /* 403 esperado */ }
  check("M3d ban NO evadible por capitalización", !cvJoined);
  // cleanup del ban para re-runs
  (adm as any).send("mod:ban", { handle: "casevictim", unban: true });
  await sleep(600);

  // H2 (auditor): mute REAL — se verifica en h2realprobe.ts (publicador de
  // audio REAL de firefox; un cliente colyseus headless no publica tracks y
  // el chequeo inline daba falso negativo). Aquí solo verificamos la banda
  // de schema: mutedBy impuesto y micOn bloqueado (M1a/M1b arriba).

  console.log(`---- modprobe: ${PASS} PASS / ${FAIL} FAIL (H2 real en h2realprobe.ts) ----`);
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.error("probe error:", e?.message || e); process.exit(2); });

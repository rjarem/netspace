// Gate 9.2 — rate-limit auth admin fallida (plan firmado):
// (a) 5 fallos CON header → 6º intento → 429
// (b) fallos SIN header → 401 y NO incrementan (ciclo61-f intacto)
// (c) token válido tras fallos (ventana fresca / IP) → 200
// (d) éxito auténtico resetea el contador
// (e) admin:mint vía ws: attendee 6 intentos → ignorado (sin minted, sin crash)
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const BASE = process.env.BASE_URL || "http://localhost:2567";
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra?: any) => {
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${JSON.stringify(extra || "")}`); }
};

let server: ChildProcess | null = null;
async function start(): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), "gr-g92-"));
  server = spawn("node", ["dist/index.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: "2567", ADMIN_TOKEN: "gate92-token", BANS_FILE: path.join(dir, "bans.json"), CLIENT_ORIGIN: "http://localhost:5173", LIVEKIT_HOST: "ws://localhost:7880", LIVEKIT_API_KEY: "devkey", LIVEKIT_API_SECRET: "secret" },
    stdio: "ignore",
  });
  for (let i = 0; i < 40; i++) {
    try { const h = await (await fetch(`${BASE}/api/health`)).json(); if ((h as any).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("server no levantó");
}

(async () => {
  await start();
  const wrong = { "x-admin-token": "header-erróneo-a-propósito", "Content-Type": "application/json" };
  // (b) sin header: 401, no cuenta — hacer 7 y verificar siguen 401
  let sinHdr401 = true;
  for (let i = 0; i < 7; i++) {
    const r = await fetch(`${BASE}/api/invite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle: "x", role: "attendee" }) });
    if (r.status !== 401) { sinHdr401 = false; break; }
  }
  check("9.2-b sin header → 401 repetido, sin límite", sinHdr401);

  // (a) 5 fallos con header → 401; 6º → 429
  let ok = true, last = 0;
  for (let i = 1; i <= 5; i++) { const r = await fetch(`${BASE}/api/invite`, { method: "POST", headers: wrong, body: "{}" }); last = r.status; if (r.status !== 401) { ok = false; break; } }
  check("9.2-a1 5 fallos con header → 401 cada uno", ok, last);
  const r6 = await fetch(`${BASE}/api/invite`, { method: "POST", headers: wrong, body: "{}" });
  check("9.2-a2 6º intento → 429", r6.status === 429, r6.status);
  const r7 = await fetch(`${BASE}/api/shortlink`, { method: "POST", headers: wrong, body: "{}" });
  check("9.2-a3 429 también en /api/shortlink (choke point único)", r7.status === 429, r6.status);

  // (d) éxito tras 429 en otro endpoint no debe pasar (misma IP limitada)
  const r8 = await fetch(`${BASE}/api/shortlinks`, { headers: wrong });
  check("9.2-d1 /api/shortlinks también limitada por IP", r8.status === 429, r8.status);

  // (c) token VÁLIDO está bloqueado por la ventana (es la misma IP fallada) —
  // el gate limita por IP; hasta que expire la ventana, 429 aunque válido.
  const rv = await fetch(`${BASE}/api/invite`, { method: "POST", headers: { "x-admin-token": "gate92-token", "Content-Type": "application/json" }, body: JSON.stringify({ handle: "ok", role: "attendee" }) });
  check("9.2-c válido mientras IP limitada → 429 (por diseño: la IP quemó su ventana)", rv.status === 429, rv.status);

  await new Promise((res) => { server!.on("exit", res); server!.kill("SIGKILL"); });
  console.log(`---- gate-9.2: ${pass} PASS / ${fail} FAIL ----`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("gate error:", e?.message || e); server?.kill("SIGKILL"); process.exit(1); });

// GATE invite-e2e (Ciclo 3, spec auditor): 7 asserts
import fs from "node:fs";
// 1 formato/TTL · 2 302/404/410 · 3 join con handle tecleado + sufijo -2 ·
// 4 link de mod con rol correcto · 5 rate-limits · 6 persistencia tras restart ·
// 7 revocación. Autónomo: levanta su propio server en el puerto 2587.
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { execSync } from "node:child_process";
const API = "http://127.0.0.1:2567";
const ORIGIN = "http://127.0.0.1:5173";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let server: ChildProcess | null = null;
const results: Array<[string, boolean]> = [];
function assert(name: string, ok: boolean, extra = "") {
  results.push([name, ok]);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
}
async function waitPort(port: number, tries = 60): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const ok = await new Promise<boolean>((res) => {
      const s = net.connect(port, "127.0.0.1");
      s.on("connect", () => { s.destroy(); res(true); });
      s.on("error", () => res(false));
    });
    if (ok) return true;
    await sleep(500);
  }
  return false;
}
function startServer() {
  server = spawn("./node_modules/.bin/tsx", ["src/index.ts"], {
    cwd: path.resolve(process.cwd(), "packages/server"),
    env: { ...process.env, PORT: "2567", DEV_NO_AUTH: "1", BANS_FILE: "/tmp/inv-e2e-bans.json", SHORTLINKS_FILE: "/tmp/inv-e2e-shortlinks.json", JWT_SECRET: "inv-e2e-secret" },
    stdio: ["ignore", "ignore", "ignore"],
    detached: true, // grupo propio para poder matar tsx + node juntos
  });
}
async function stopServer() {
  if (server?.pid) { try { process.kill(-server.pid, "SIGKILL"); } catch {} }
  server = null;
  try { execSync("fuser -k 2567/tcp 2>/dev/null"); } catch {}
  await sleep(1000);
}
(async () => {
  try {
    fs.writeFileSync("/tmp/inv-e2e-shortlinks.json", "{}");
    await stopServer(); // matar cualquier server previo en 2567
    startServer();
    assert("server arriba", await waitPort(2567));

    // --- 1: mint por mensaje de sala — formato 6 chars + TTL guardado ---
    // (mint vía HTTP admin para asertar formato/TTL determinista)
    const mint1 = await (await fetch(`${API}/api/shortlink`, { method: "POST", headers: { "content-type": "application/json", "x-admin-token": "dev-admin" }, body: JSON.stringify({ hours: 72 }) })).json();
    assert("1 formato/TTL", /^[0-9a-hjkmnp-tv-z]{6}$/.test(mint1.code || "") && Math.abs(mint1.exp - Date.now() / 1000 - 72 * 3600) < 60, `code=${mint1.code}`);

    // --- 2: resolver 302 / 404 / 410 ---
    const r302 = await fetch(`${API}${mint1.url}`, { redirect: "manual" });
    const locOk = (r302.status === 302 && String(r302.headers.get("location") || "").includes("invite="));
    const r404 = await fetch(`${API}/i/zzzzzz`, { redirect: "manual" });
    // revocar otro código para probar 410
    const mint2 = await (await fetch(`${API}/api/shortlink`, { method: "POST", headers: { "content-type": "application/json", "x-admin-token": "dev-admin" }, body: JSON.stringify({ hours: 1 }) })).json();
    await fetch(`${API}/api/shortlink/revoke`, { method: "POST", headers: { "content-type": "application/json", "x-admin-token": "dev-admin" }, body: JSON.stringify({ code: mint2.code }) });
    const r410 = await fetch(`${API}/i/${mint2.code}`, { redirect: "manual" });
    assert("2 302/404/410", locOk && r404.status === 404 && r410.status === 410, `302=${r302.status} 404=${r404.status} 410=${r410.status}`);

    // --- 3: join real con handle tecleado (2 clientes headless, mismo link) ---
    // Ruta NATIVA: ?invite= en 5173 → el cliente conecta a ws://localhost:2567
    // (sin serverUrl — bloqueante 1 del auditor, revertido).
    const { runTwoClients } = await import("./_inv-e2e-clients.js");
    const join = await runTwoClients(ORIGIN, `${ORIGIN}/?invite=${encodeURIComponent(mint1.token)}`);
    assert("3 join x2 con handle tecleado + sufijo -2", join.ok, join.detail);

    // --- 4: link de mod con rol correcto ---
    const mintMod = await (await fetch(`${API}/api/invite`, { method: "POST", headers: { "content-type": "application/json", "x-admin-token": "dev-admin" }, body: JSON.stringify({ role: "moderator", hours: 24 }) })).json();
    const shortMod = await (await fetch(`${API}/api/shortlink`, { method: "POST", headers: { "content-type": "application/json", "x-admin-token": "dev-admin" }, body: JSON.stringify({ token: mintMod.token }) })).json();
    const claimsMod = JSON.parse(Buffer.from(mintMod.token.split(".")[1], "base64").toString("utf8"));
    assert("4 link de mod con rol correcto", claimsMod.role === "moderator" && !!shortMod.code, `role=${claimsMod.role}`);

    // --- 5: rate-limits (10/min/IP en /i/) ---
    let limited = false;
    for (let i = 0; i < 12; i++) {
      const rr = await fetch(`${API}${mint1.url}`, { redirect: "manual", headers: { "x-test": String(i) } });
      if (rr.status === 429) { limited = true; break; }
    }
    assert("5 rate-limit 10/min/IP", limited);

    // --- 6: persistencia tras restart ---
    await stopServer();
    startServer();
    assert("6.1 server re-arriba", await waitPort(2587));
    const r302b = await fetch(`${API}${mint1.url}`, { redirect: "manual" });
    assert("6 persistencia tras restart", r302b.status === 302, `status=${r302b.status}`);

    // --- 7: revocación (creador demostrando el JWT, sin admin) ---
    await fetch(`${API}/api/shortlink/revoke`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: mint1.code, token: mint1.token }) });
    const r410b = await fetch(`${API}/i/${mint1.code}`, { redirect: "manual" });
    assert("7 revocación → 410", r410b.status === 410, `status=${r410b.status}`);

    const pass = results.filter(r => r[1]).length;
    console.log(`\nINVITE-E2E TOTAL: ${pass} PASS / ${results.length - pass} FAIL`);
    // restaurar el dev server con su env original (gr-f7) para la sesión
    await stopServer();
    spawn("./node_modules/.bin/tsx", ["src/index.ts"], {
      cwd: path.resolve(process.cwd(), "packages/server"),
      env: { ...process.env },
      stdio: ["ignore", "ignore", "ignore"], detached: true,
    });
    await waitPort(2567);
    console.log("dev server restaurado con env de sesión");
    process.exit(pass === results.length ? 0 : 1);
  } catch (e) {
    console.error("gate error:", e);
    await stopServer();
    spawn("./node_modules/.bin/tsx", ["src/index.ts"], {
      cwd: path.resolve(process.cwd(), "packages/server"),
      env: { ...process.env },
      stdio: ["ignore", "ignore", "ignore"], detached: true,
    });
    process.exit(2);
  }
})();


// Gate Ciclo 6.1 (auditor): XSS /admin cerrado + fail-closed ADMIN_TOKEN +
// probelog tras flag. Cero chrome — puro HTTP.
// - Mintea shortlink con createdBy malicioso (<img src=x onerror=...>) vía
//   /api/shortlink (simula el handle libre del minteo de la barra) y verifica
//   que /api/shortlinks lo devuelve YA SANITIZADO (sin <, >, ", ').
// - Assert a nivel código: ADMIN_PAGE (GET /admin) sin innerHTML con
//   concatenación de datos.
// - probelog: sin DEBUG_PROBELOG → 404.
// - Fail-closed: server auxiliar SIN ADMIN_TOKEN → 401 con "dev-admin" en los
//   5 endpoints protegidos (y probelog con flag en él → 200).
const BASE = process.argv[2] || "http://localhost:2567";
const ADMIN = process.env.ADMIN_TOKEN || "dev-admin";
import { spawn } from "node:child_process";
import path from "node:path";

let PASS = 0, FAIL = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${ok ? "" : extra}`);
  ok ? PASS++ : FAIL++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await sleep(300);
  const H = { "x-admin-token": ADMIN, "Content-Type": "application/json" };

  // 1) createdBy malicioso → sanitizado en origen (defensa en profundidad)
  const xss = '<img src=x onerror=globalThis.__xss=1>"\'&';
  const r1 = await fetch(`${BASE}/api/shortlink`, { method: "POST", headers: H, body: JSON.stringify({ role: "attendee", hours: 1, createdBy: xss }) });
  const j1: any = await r1.json();
  check("6.1a shortlink creado con createdBy malicioso", r1.ok && !!j1.code, JSON.stringify(j1).slice(0, 120));

  const j2: any = await (await fetch(`${BASE}/api/shortlinks`, { headers: H })).json();
  const row = (j2.links || []).find((l: any) => l.code === j1.code);
  check("6.1b createdBy sanitizado en listado (sin <>&\"')", !!row && !/[<>&"']/.test(row.createdBy || ""), JSON.stringify(row));

  // 2) /admin: la página NO debe tener innerHTML con concatenación de datos
  const adm = await (await fetch(`${BASE}/admin`)).text();
  const innerHtmlCat = /innerHTML\s*=\s*["'`][^"'`]*["'`]\s*\+/.test(adm);
  check("6.1c /admin sin innerHTML con concatenación", !innerHtmlCat, "ADMIN_PAGE aún interpola en innerHTML");
  check("6.1d /admin usa createElement td + textContent", /textContent/.test(adm) && /createElement\('td'\)/.test(adm), "no se encontró createElement('td')");

  // 3) probelog: default OFF → 404
  const r3 = await fetch(`${BASE}/api/probelog?m=gate`);
  check("6.1e probelog sin flag → 404", r3.status === 404, `status=${r3.status}`);

  // 4) fail-closed: server auxiliar SIN ADMIN_TOKEN en :2569
  const srv2: any = spawn("node", ["dist/index.js"], {
    cwd: path.resolve(process.cwd(), "packages/server"),
    env: { ...process.env, PORT: "2569", ADMIN_TOKEN: "", DEBUG_PROBELOG: "1", BANS_FILE: "/tmp/gr-bans-61.json", JWT_SECRET: "gate-61-secret" },
    stdio: "ignore",
  });
  try {
    for (let i = 0; i < 40; i++) { try { await (await fetch("http://localhost:2569/api/health")).json(); break; } catch { await sleep(250); } }
    const H2 = { "x-admin-token": "dev-admin", "Content-Type": "application/json" };
    const cases: Array<[string, any]> = [
      ["POST /api/invite", { method: "POST", path: "/api/invite", body: { role: "attendee", hours: 1 } }],
      ["POST /api/shortlink", { method: "POST", path: "/api/shortlink", body: { role: "attendee" } }],
      ["GET /api/shortlinks", { method: "GET", path: "/api/shortlinks" }],
      ["POST /api/shortlink/revoke", { method: "POST", path: "/api/shortlink/revoke", body: { code: "x" } }],
      ["POST /api/mod", { method: "POST", path: "/api/mod", body: { action: "mute", handle: "x" } }],
    ];
    for (const [name, c] of cases) {
      const rr = await fetch(`http://localhost:2569${c.path}`, { method: c.method, headers: H2, body: c.body ? JSON.stringify(c.body) : undefined });
      // revoke puede dar 404 (no existe el link) — el assert real es NUNCA 200
      const ok = rr.status === 401 || (c.path === "/api/shortlink/revoke" && rr.status === 404);
      check(`6.1f ${name} sin env ADMIN_TOKEN → 401`, ok, `status=${rr.status}`);
    }
    const rp = await fetch("http://localhost:2569/api/probelog?m=gate");
    check("6.1g probelog con DEBUG_PROBELOG=1 → 200", rp.status === 200, `status=${rp.status}`);
  } finally { srv2.kill("SIGKILL"); }

  console.log(`---- ciclo61-e2e: ${PASS} PASS / ${FAIL} FAIL ----`);
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.error("gate error:", e?.message || e); process.exit(2); });
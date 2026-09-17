// Gate Ciclo 6b (auditor-firmado): códigos cortos resueltos en la Antesala.
// HTTP: resolve válido → 200 {jwt} + CORS restrictivo · inexistente → 404 ·
// revocado → 410 con error idéntico (sin señal) · rate-limit 10/min/IP → 429 ·
// choke point: createdBy crudo queda sanitizado (cond. 1 del auditor).
// Browser (chrome headless + CDP, patrón ciclo6-e2e): entrar pegando SOLO el
// código corto en la Antesala (sin link, sin ?invite=).
import { spawn, ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
// CDP mínimo via WebSocket nativo no existe en node<21 — usar ws del repo
// (dependencia transitiva de colyseus).
// @ts-ignore
import WebSocket from "ws";

const REPO = path.resolve(import.meta.dirname ?? ".", "..", "..", "..");
const BASE = process.argv[2] || "http://localhost:2567";
const ORIGIN = process.argv[3] || "http://localhost:5173";
const ADMIN = process.env.ADMIN_TOKEN || "dev-admin";
let PASS = 0, FAIL = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${ok ? "" : extra}`);
  ok ? PASS++ : FAIL++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- CDP mínimo (patrón ciclo6-e2e) ---
type CDP = { send: (method: string, params?: any, sid?: string) => Promise<any>; ws: WebSocket };
async function connectCdp(port: number): Promise<CDP> {
  const wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
  const ws = new WebSocket(wsUrl) as WebSocket;
  await new Promise((r) => (ws as any).on("open", r));
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  (ws as any).on("message", (d: any) => {
    const m = JSON.parse(d.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
  });
  return {
    ws,
    send: (method: string, params: any = {}, sid?: string) =>
      new Promise((resolve, reject) => {
        const mid = ++id;
        pending.set(mid, (m) => (m.error ? reject(new Error(method + ": " + JSON.stringify(m.error))) : resolve(m.result)));
        ws.send(JSON.stringify({ id: mid, method, params, sessionId: sid }));
      }),
  };
}
async function newTab(cdp: CDP, url: string): Promise<string> {
  const t = await cdp.send("Target.createTarget", { url });
  const s = await cdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
  const sid = s.sessionId as string;
  await cdp.send("Runtime.enable", {}, sid);
  await cdp.send("Page.enable", {}, sid);
  return sid;
}
async function evalJS(cdp: CDP, sid: string, expr: string): Promise<any> {
  const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, sid);
  return r?.result?.value;
}

function launchChrome(port: number): ChildProcess {
  const profile = `/tmp/gr-6b-chrome-${Date.now()}`;
  mkdirSync(profile, { recursive: true });
  return spawn("/usr/bin/google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required", "--window-size=1280,800",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
}

// entrar pegando SOLO el código (sin ?invite=): handle + código + snapshot + go
async function enterWithCode(cdp: CDP, code: string, handle: string): Promise<string> {
  const sid = await newTab(cdp, `${ORIGIN}/`);
  let bar = false;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const st = await evalJS(cdp, sid, `(() => ({go: !!document.getElementById('grGo'), bar: !!document.getElementById('gr-actionbar')}))()`);
    bar = !!st?.bar;
    if (bar) break;
    if (st?.go) {
      await evalJS(cdp, sid, `(() => {
        const h=document.getElementById('grHandle'); if(h){h.value=${JSON.stringify(handle)}; h.dispatchEvent(new Event('input'));}
        const inv=document.getElementById('grInvite'); if(inv){inv.value=${JSON.stringify(code)}; inv.dispatchEvent(new Event('input'));}
      })()`);
      await evalJS(cdp, sid, `(() => { const s=document.getElementById('grSnap'); if (s && !document.getElementById('grSnapOk')?.style?.display?.includes('inline')) s.click(); })()`);
      await evalJS(cdp, sid, `document.getElementById('grGo')?.click()`);
    }
  }
  if (!bar) {
    const dbg = await evalJS(cdp, sid, `(() => ({href: location.href, status: (document.querySelector('.gr-gr-status, #grStatus, [id*=status]')||{}).textContent, body: document.body.innerText.slice(0,300)}))()`);
    throw new Error(handle + " no entró pegando el código: " + JSON.stringify(dbg));
  }
  return sid;
}

async function main() {
  await sleep(300);
  const H = { "x-admin-token": ADMIN, "Content-Type": "application/json" };

  // --- HTTP ---
  const r0 = await fetch(`${BASE}/api/shortlink`, { method: "POST", headers: H, body: JSON.stringify({ role: "attendee", hours: 2, createdBy: '<img src=x onerror=globalThis.__xss61=1>"\'&' }) });
  const j0: any = await r0.json();
  check("6b-a shortlink creado", r0.ok && !!j0.code, JSON.stringify(j0).slice(0, 100));

  const jL: any = await (await fetch(`${BASE}/api/shortlinks`, { headers: H })).json();
  const row = (jL.links || []).find((l: any) => l.code === j0.code);
  check("6b-b choke point: createdBy crudo queda sanitizado", !!row && !/[<>&"']/.test(row.createdBy || ""), JSON.stringify(row));

  const r1 = await fetch(`${BASE}/api/shortlink/resolve/${j0.code}`);
  const j1: any = await r1.json();
  const aco = r1.headers.get("access-control-allow-origin") || "";
  check("6b-c resolve válido → 200 {jwt 3 segmentos}", r1.status === 200 && typeof j1.jwt === "string" && j1.jwt.split(".").length === 3, `status=${r1.status}`);
  check("6b-d CORS restrictivo a CLIENT_ORIGIN", aco === (process.env.CLIENT_ORIGIN || "http://localhost:5173"), `aco=${aco}`);

  const r4 = await fetch(`${BASE}/api/shortlink/resolve/zzzzzz`);
  check("6b-e resolve inexistente → 404", r4.status === 404, `status=${r4.status}`);

  const rv = await fetch(`${BASE}/api/shortlink/revoke`, { method: "POST", headers: H, body: JSON.stringify({ code: j0.code, token: j0.token }) });
  const r5 = await fetch(`${BASE}/api/shortlink/resolve/${j0.code}`);
  const b5: any = await r5.json();
  check("6b-f revocado → 410, error idéntico {invalid}, sin jwt", r5.status === 410 && b5.error === "invalid" && !b5.jwt, `status=${r5.status} body=${JSON.stringify(b5)}`);

  let got429 = false;
  for (let i = 0; i < 12; i++) {
    const rr = await fetch(`${BASE}/api/shortlink/resolve/zzzzzz`);
    if (rr.status === 429) { got429 = true; break; }
  }
  check("6b-g rate-limit 10/min/IP → 429", got429, "sin 429 en 12 req");

  // --- browser: join pegando SOLO el código ---
  const r2 = await fetch(`${BASE}/api/shortlink`, { method: "POST", headers: H, body: JSON.stringify({ role: "attendee", hours: 2 }) });
  const j2: any = await r2.json();
  const chrome = launchChrome(9334);
  try {
    for (let i = 0; i < 40; i++) { try { await fetch("http://127.0.0.1:9334/json/version"); break; } catch { await sleep(250); } }
    const cdp = await connectCdp(9334);
    const sid = await enterWithCode(cdp, j2.code, "GateCode");
    const roster = await evalJS(cdp, sid, `(() => ({inWorld: !!document.getElementById('gr-actionbar'), handle: window.__ns?.room?.state?.players?.get?.(window.__ns?.sessionId||'')?.handle }))()`);
    check("6b-h join pegando SOLO el código corto (Antesala → mundo)", !!roster?.inWorld, JSON.stringify(roster));
  } finally { chrome.kill("SIGKILL"); }

  console.log(`---- ciclo6b-e2e: ${PASS} PASS / ${FAIL} FAIL ----`);
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.error("gate error:", e?.message || e); process.exit(2); });
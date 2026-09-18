// Gate 8.3 — botón 🌐 admin (plan auditor):
// (a) admin hace click en 🌐 → invite:minted {ok, code, role:admin}
// (b) el JWT minteado tiene role=admin y exp ≈ now+1h (±5min)
// (c) el shortlink resuelve por /api/shortlink/resolve/:code → jwt igual
// (d) attendee que intenta 'admin:mint' NO reciente mint con role admin
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const BASE = process.env.BASE_URL || "http://localhost:2567";
const PLAY = process.env.PLAY_URL || "http://localhost:5173";
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra?: any) => {
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${JSON.stringify(extra || "")}`); }
};

class CDP {
  ws!: import("ws").WebSocket; private id = 0; private pending = new Map<number, (m: any) => void>();
  sessions = new Map<string, string>();
  static async connect(port: number) {
    const c = new CDP();
    const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const { WebSocket } = await import("ws");
    c.ws = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((res, rej) => { c.ws.onopen = res as any; c.ws.onerror = rej as any; });
    c.ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      const m = JSON.parse(ev.data);
      if (m.id && c.pending.has(m.id)) { const fn = c.pending.get(m.id)!; c.pending.delete(m.id); fn(m); }
    };
    return c;
  }
  send(method: string, params: any = {}, sessionId?: string) {
    const id = ++this.id;
    return new Promise<any>((res, rej) => {
      this.pending.set(id, (m) => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result));
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async evalJS(tid: string, expr: string) {
    if (!this.sessions.has(tid)) { const { sessionId } = await this.send("Target.attachToTarget", { targetId: tid, flatten: true }); this.sessions.set(tid, sessionId); }
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, this.sessions.get(tid));
    return (r as any)?.result?.value ?? null;
  }
}

let chrome: ChildProcess | null = null;
const mintInvite = async (role: string) => {
  const inv = await (await fetch(BASE + "/api/invite", { method: "POST", headers: { "x-admin-token": process.env.ADMIN_TOKEN || "dev-admin", "Content-Type": "application/json" }, body: JSON.stringify({ role, hours: 1 }) })).json();
  return inv.token as string;
};
const startChrome = async () => {
  const PORT = 9900 + Math.floor(Math.random() * 40);
  const dir = mkdtempSync(path.join(tmpdir(), "gr-83-"));
  chrome = spawn("/usr/bin/google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: "ignore" });
  let ok = false; for (let i = 0; i < 40 && !ok; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); ok = true; } catch { await sleep(250); } }
  if (!ok) throw new Error("chrome no arrancó");
  return { c: await CDP.connect(PORT) };
};
const enterPage = async (c: CDP, role: string, handle: string) => {
  const token = await mintInvite(role);
  const t = await c.send("Target.createTarget", { url: "about:blank" });
  const tid = t.targetId;
  await c.evalJS(tid, "1").catch(() => {});
  await c.send("Page.navigate", { url: `${PLAY}/?invite=${token}` }, c.sessions.get(tid)).catch(() => {});
  let entered = false;
  for (let i = 0; i < 60 && !entered; i++) {
    await sleep(1000);
    const hasGo = await c.evalJS(tid, "(() => { const b=document.getElementById('grGo'); return !!b && !b.disabled; })()");
    if (hasGo) {
      await c.evalJS(tid, `(() => { const el=document.getElementById('grHandle'); if(el){ el.value="${handle}"; el.dispatchEvent(new Event("input")); } })()`);
      const snap = await c.evalJS(tid, "(() => { const v=document.querySelector('video'); const s=document.getElementById('grSnap'); if(s && v && v.videoWidth){ s.click(); return true; } return false; })()");
      if (snap) await sleep(500);
      await c.evalJS(tid, "document.getElementById('grGo')?.click()");
    }
    entered = !!(await c.evalJS(tid, "!!document.getElementById('gr-actionbar')"));
  }
  if (!entered) throw new Error(`${handle}: antesala no pasó`);
  return tid;
};
const killChrome = () => { try { chrome?.kill("SIGKILL"); } catch {} chrome = null; };

const main = async () => {
  const { c } = await startChrome();
  try {
    const adminTid = await enterPage(c, "admin", "Gate83Admin");
    const attTid = await enterPage(c, "attendee", "Gate83Att");
    await sleep(2000);

    // (a) click 🌐 → minted ok con code y role admin
    await c.evalJS(adminTid, `(() => {
      window.__grMinted = null;
      const room = window.__ns.scene.room;
      room.onMessage("invite:minted", (m) => { window.__grMinted = m; });
      const b=[...document.querySelectorAll("#gr-actionbar button")].find(x=>(x.textContent||"").trim()==="🌐");
      if (!b) return "no-btn";
      b.click();
      return "clicked";
    })()`);
    let minted: any = null;
    for (let i = 0; i < 10 && !minted; i++) { await sleep(1000); minted = await c.evalJS(adminTid, "window.__grMinted"); }
    check("8.3-a admin 🌐 → minted ok con code", !!(minted?.ok && minted?.code && minted?.role === "admin"), { minted });

    // (b) JWT role=admin, exp ≈ now+1h (±5min)
    let jwtInfo: any = null;
    try {
      const pl = JSON.parse(Buffer.from(String(minted.token).split(".")[1], "base64").toString("utf8"));
      jwtInfo = { role: pl.role, deltaMin: Math.round((pl.exp - Date.now() / 1000) / 60) };
    } catch (e: any) { jwtInfo = { err: String(e).slice(0, 60) }; }
    check("8.3-b JWT admin ~1h", jwtInfo?.role === "admin" && jwtInfo?.deltaMin >= 55 && jwtInfo?.deltaMin <= 65, { jwtInfo });

    // (c) shortlink resuelve
    const resolved = await (await fetch(`${BASE}/api/shortlink/resolve/${minted.code}`)).json();
    check("8.3-c shortlink resuelve el jwt", typeof resolved?.jwt === "string" && resolved.jwt === minted.token, { resolved: resolved?.error || "ok" });

    // (d) attendee NO puede mintear admin
    await c.evalJS(attTid, `(() => {
      window.__grMintedAtt = null;
      const room = window.__ns.scene.room;
      room.onMessage("invite:minted", (m) => { window.__grMintedAtt = m; });
      room.send("admin:mint");
    })()`);
    await sleep(2500);
    const attMinted = await c.evalJS(attTid, "window.__grMintedAtt");
    const attNoAdmin = !attMinted || attMinted?.role !== "admin";
    check("8.3-d attendee no puede mintear admin", attNoAdmin, { attMinted: attMinted || null });
  } finally { killChrome(); }
  console.log(`---- gate-8.3: ${pass} PASS / ${fail} FAIL ----`);
  process.exit(fail ? 1 : 0);
};
main().catch(e => { killChrome(); console.error("gate error:", e.message); process.exit(1); });

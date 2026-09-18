// Gate 9.1 — sesión persistente del invitado (plan firmado + precisiones):
// (a) ?invite attendee → gr-invite + gr-invite-exp guardados
// (b) recarga sin ?invite → campo pre-lleno + forget visible (1 click)
// (c) invite expirado en storage → limpiado + hint
// (d) jwt role=admin → NO se persiste
// (e) olvidar → keys fuera, campo vacío
// (f) handle guardado → pre-llenado
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
  static async connect(port: number): Promise<CDP> {
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
const mintInvite = async (role: string, hours = 1) => {
  const inv = await (await fetch(BASE + "/api/invite", { method: "POST", headers: { "x-admin-token": process.env.ADMIN_TOKEN || "dev-admin", "Content-Type": "application/json" }, body: JSON.stringify({ role, hours }) })).json();
  return inv.token as string;
};
const startChrome = async () => {
  const PORT = 9950 + Math.floor(Math.random() * 40);
  const dir = mkdtempSync(path.join(tmpdir(), "gr-91-"));
  chrome = spawn("/usr/bin/google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: "ignore" });
  let ok = false; for (let i = 0; i < 40 && !ok; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); ok = true; } catch { await sleep(250); } }
  if (!ok) throw new Error("chrome no arrancó");
  return await CDP.connect(PORT);
};
const killChrome = () => { try { chrome?.kill("SIGKILL"); } catch {} chrome = null; };

const main = async () => {
  const c: CDP = await startChrome();
  try {
    const t = await c.send("Target.createTarget", { url: "about:blank" });
    const tid = t.targetId;
    const nav = async (url: string) => {
      await c.evalJS(tid, "1"); // fuerza attach del target antes de navegar
      await c.send("Page.enable", {}, c.sessions.get(tid)).catch(() => {});
      await c.send("Page.navigate", { url }, c.sessions.get(tid)).catch(() => {});
      for (let i = 0; i < 60; i++) { await sleep(500); const g = await c.evalJS(tid, "!!document.getElementById('grGo')"); if (g) { await sleep(300); return; } }
    };
    // (a)
    const att = await mintInvite("attendee", 1);
    await nav(`${PLAY}/?invite=${att}`);
    const a = await c.evalJS(tid, "(() => ({ inv: localStorage.getItem('gr-invite'), exp: localStorage.getItem('gr-invite-exp') }))()");
    check("9.1-a ?invite attendee → gr-invite + exp guardados", !!a?.inv && !!a?.exp, a);

    // (b)
    await nav(`${PLAY}/`);
    const b = await c.evalJS(tid, `(() => {
      const f = document.getElementById('grInvite');
      const forget = document.getElementById('grForget');
      return { val: f ? f.value : "", forgetVisible: !!forget && forget.style.display !== "none" };
    })()`);
    check("9.1-b recarga → campo pre-lleno con guardada", b?.val === att && b?.forgetVisible === true, b);

    // (e)
    await c.evalJS(tid, "document.getElementById('grForget')?.click()");
    const e = await c.evalJS(tid, "(() => ({ inv: localStorage.getItem('gr-invite'), val: (document.getElementById('grInvite')||{}).value || '' }))()");
    check("9.1-e olvidar → storage limpio y campo vacío", !e?.inv && !e?.val, e);

    // (d)
    const adm = await mintInvite("admin", 1);
    await nav(`${PLAY}/?invite=${adm}`);
    const d = await c.evalJS(tid, "localStorage.getItem('gr-invite')");
    check("9.1-d jwt admin → NO persistido", !d, d);

    // (c)
    await c.evalJS(tid, `(() => { localStorage.setItem('gr-invite', ${JSON.stringify(att)}); localStorage.setItem('gr-invite-exp', String(Math.floor(Date.now()/1000) - 10)); })()`);
    await nav(`${PLAY}/`);
    const cc = await c.evalJS(tid, `(() => ({
      inv: localStorage.getItem('gr-invite'),
      info: (document.getElementById('grInviteInfo')||{}).textContent || "",
      val: (document.getElementById('grInvite')||{}).value || ""
    }))()`);
    check("9.1-c expirado → storage limpio + hint", !cc?.inv && !cc?.val && /expir/i.test(cc?.info || ""), cc);

    // (f)
    await c.evalJS(tid, `(() => { localStorage.setItem('gr-handle', 'Gate91Rec'); })()`);
    await nav(`${PLAY}/`);
    const f = await c.evalJS(tid, "(document.getElementById('grHandle')||{}).value");
    check("9.1-f handle guardado → pre-lleno", f === "Gate91Rec", f);
  } finally { killChrome(); }
  console.log(`---- gate-9.1: ${pass} PASS / ${fail} FAIL ----`);
  process.exit(fail ? 1 : 0);
};
main().catch((e2) => { console.error("gate error:", e2?.message || e2); killChrome(); process.exit(1); });

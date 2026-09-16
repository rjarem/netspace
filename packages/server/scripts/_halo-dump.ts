// Headless: entra como ADMIN y dump del halo de rol (color/alpha/posición)
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const BASE = "http://localhost:2567", ORIGIN = "http://127.0.0.1:5173";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
class CDP {
  ws!: import("ws").WebSocket; private id = 0; private pending = new Map<number, (m: any) => void>();
  sessions = new Map<string, string>();
  static async connect(port: number) {
    const c = new CDP();
    const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const { WebSocket } = await import("ws");
    c.ws = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((res, rej) => { c.ws.onopen = res as any; c.ws.onerror = rej as any; });
    c.ws.onmessage = (ev) => { const m = JSON.parse(String(ev.data)); if (m.id && c.pending.has(m.id)) { const fn = c.pending.get(m.id)!; c.pending.delete(m.id); fn(m); } };
    return c;
  }
  send(method: string, params: any = {}, sessionId?: string) { const id = ++this.id; return new Promise<any>((res, rej) => { this.pending.set(id, (m) => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)); this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
  async evalJS(tid: string, expr: string) {
    if (!this.sessions.has(tid)) { const { sessionId } = await this.send("Target.attachToTarget", { targetId: tid, flatten: true }); this.sessions.set(tid, sessionId); }
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, this.sessions.get(tid));
    return (r as any)?.result?.value ?? null;
  }
}
(async () => {
  let chrome: ChildProcess | null = null;
  try {
    const PORT = 9510 + Math.floor(Math.random() * 30);
    const dir = mkdtempSync(path.join(tmpdir(), "gr-halo-"));
    chrome = spawn("/usr/bin/google-chrome", ["--headless=new","--no-sandbox","--disable-gpu",`--remote-debugging-port=${PORT}`,`--user-data-dir=${dir}`,"--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream","about:blank"], { stdio: "ignore" });
    let ok = false; for (let i = 0; i < 40 && !ok; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); ok = true; } catch { await sleep(250); } }
    const c = await CDP.connect(PORT);
    const jwt = process.env.HJWT || "";
    const t = await c.send("Target.createTarget", { url: jwt ? `${ORIGIN}/?invite=${encodeURIComponent(jwt)}` : `${ORIGIN}/?probe=haloadmin&handle=HaloAdmin&role=admin` });
    const tid = t.targetId;
    let entered = false;
    for (let i = 0; i < 30 && !entered; i++) {
      await sleep(1000);
      if (await c.evalJS(tid, "!!document.getElementById('grGo')")) {
        await c.evalJS(tid, "(() => { const v=document.querySelector('video'); const s=document.getElementById('grSnap'); if(s && v && v.videoWidth) s.click(); })()");
        await sleep(300);
        await c.evalJS(tid, "document.getElementById('grGo')?.click()");
      }
      entered = !!(await c.evalJS(tid, "!!document.getElementById('gr-actionbar')"));
    }
    if (!entered) throw new Error("no entró");
    await sleep(4000);
    const dump = await c.evalJS(tid, `(() => { const s=window.__ns?.scene; if(!s) return 'sin scene'; const out=[]; for (const [id,p] of s.players) { out.push({id: id.slice(0,4), handle: p.handle, role: p.schema?.role, hayHalo: !!p.roleHalo, color: p.roleHalo?.strokeColor, alpha: +(p.roleHalo?.strokeAlpha||0).toFixed(2), x: Math.round(p.roleHalo?.x||0), y: Math.round(p.roleHalo?.y||0), depth: p.roleHalo?.depth, spriteDepth: p.sprite?.depth}); } return out; })()`);
    console.log(JSON.stringify(dump, null, 1));
  } finally { try { chrome?.kill(); } catch {} }
})();

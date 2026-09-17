// Helper invite-e2e: 2 clientes headless que entran con el mismo link de
// evento, tecleando su handle (flujo 6baa31) — el segundo obtiene sufijo -2.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
let chrome: ChildProcess | null = null;
export async function runTwoClients(ORIGIN: string, url: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const PORT = 9760 + Math.floor(Math.random() * 30);
    const dir = mkdtempSync(path.join(tmpdir(), "gr-inv-"));
    chrome = spawn("/usr/bin/google-chrome", ["--headless=new","--no-sandbox","--disable-gpu","--disable-dev-shm-usage",`--remote-debugging-port=${PORT}`,`--user-data-dir=${dir}`,"--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream","about:blank"], { stdio: "ignore" });
    let cdpOk = false; for (let i = 0; i < 40 && !cdpOk; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); cdpOk = true; } catch { await sleep(250); } }
    const c = await CDP.connect(PORT);
    const handles = ["InvE2e", "InvE2e"];
    const ids: string[] = [];
    for (let k = 0; k < 2; k++) {
      const t = await c.send("Target.createTarget", { url: ORIGIN });
      ids.push(t.targetId);
      const gateUrl = url;
      // teclear handle en la Antesala (input gr-name) y continuar con el invite
      let entered = false;
      for (let i = 0; i < 45 && !entered; i++) {
        await sleep(1000);
        const body = await c.evalJS(ids[k], "!!document.body");
        if (!body) {
          await c.send("Page.navigate", { url: `${gateUrl}&retry=${i}` }, c.sessions.get(ids[k])).catch(() => {});
          await sleep(1500);
          continue;
        }
        const handleIn = await c.evalJS(ids[k], "!!document.getElementById('grHandle')");
        if (handleIn) {
          await c.evalJS(ids[k], `(() => { const el=document.getElementById('grHandle'); if(el && !el.value){ el.value="${handles[k]}"; el.dispatchEvent(new Event("input")); } })()`);
        }
        const snapBtn = await c.evalJS(ids[k], "!!document.getElementById('grSnap')");
        if (snapBtn) {
          const took = await c.evalJS(ids[k], "(() => { const v=document.querySelector('video'); const s=document.getElementById('grSnap'); if(s && v && v.videoWidth){ s.click(); return true; } return false; })()");
          if (took) await sleep(500);
        }
        if (await c.evalJS(ids[k], "(() => { const b=document.getElementById('grGo'); return !!b && !b.disabled; })()")) {
          await c.evalJS(ids[k], "document.getElementById('grGo')?.click()");
        }
        entered = !!(await c.evalJS(ids[k], "!!document.getElementById('gr-actionbar')"));
      }
      if (!entered) {
        const st = await c.evalJS(ids[k], "document.body?.innerText?.slice(0,200) || 'sin body'");
        return { ok: false, detail: `cliente ${k} no entró — estado: ${st}` };
      }
    }
    // ¿entró el 2º con sufijo -2? — dump completo de la sala (server truth)
    const names = [];
    for (const tid of ids) {
      names.push(await c.evalJS(tid, "(() => { const s=window.__ns.scene; return [...s.players.values()].map(p=>p.handle).join(','); })()"));
    }
    chrome?.kill(); chrome = null;
    const ok = String(names[1] || "").split(",").includes("InvE2e-2") || names[0] === "InvE2e" && String(names[1]) === "InvE2e-2";
    return { ok, detail: `roster=${JSON.stringify(names)}` };
  } catch (e: any) {
    return { ok: false, detail: String(e?.message || e) };
  } finally { try { chrome?.kill(); } catch {} }
}

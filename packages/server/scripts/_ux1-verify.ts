// Verificación headless del Ciclo 1 UX: mapa-overlay, emojis, monocromo, halos.
// Patrón debug-enter (2/2 entradas): photo programática + click robusto.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://localhost:2567";
const ORIGIN = process.argv[3] || "http://127.0.0.1:5173";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class CDP {
  ws!: import("ws").WebSocket; private id = 0; private pending = new Map<number, (m: any) => void>();
  events: ((m: any) => void)[] = [];
  static async connect(port: number) {
    const c = new CDP();
    const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const { WebSocket } = await import("ws");
    c.ws = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((res, rej) => { c.ws.onopen = res as any; c.ws.onerror = rej as any; });
    c.ws.onmessage = (ev) => { const m = JSON.parse(String(ev.data)); if (m.id && c.pending.has(m.id)) { const fn = c.pending.get(m.id)!; c.pending.delete(m.id); fn(m); } else if (m.method) c.events.forEach((f) => f(m)); };
    return c;
  }
  send(method: string, params: any = {}, sessionId?: string) { const id = ++this.id; return new Promise<any>((res, rej) => { this.pending.set(id, (m) => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)); this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
  async evalJS(targetId: string, expr: string) {
    if (!this.sessions.has(targetId)) {
      const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
      this.sessions.set(targetId, sessionId);
    }
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, this.sessions.get(targetId));
    return (r as any)?.result?.value ?? null;
  }
  sessions = new Map<string, string>();
}

async function newTab(c: CDP, url: string) { const t = await c.send("Target.createTarget", { url }); return t.targetId; }

async function enter(c: CDP, tid: string, handle: string) {
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const st = await c.evalJS(tid, "(() => ({go: !!document.getElementById('grGo'), body: document.body.innerText.slice(0,80)}))()");
    if (st?.go) {
      await c.evalJS(tid, `(() => { const h=document.getElementById('grHandle'); if(h){h.value=${JSON.stringify(handle)}; h.dispatchEvent(new Event('input'));} const v=document.querySelector('video'); const s=document.getElementById('grSnap'); if(s && v && v.videoWidth) s.click(); })()`);
      await sleep(400);
      await c.evalJS(tid, "document.getElementById('grGo')?.click()");
      const bar = await c.evalJS(tid, "!!document.getElementById('gr-actionbar')");
      if (bar) return true;
    }
  }
  return false;
}

(async () => {
  let chrome: ChildProcess | null = null;
  try {
    const PORT = 9460 + Math.floor(Math.random() * 30);
    const dir = mkdtempSync(path.join(tmpdir(), "gr-ux1-chrome-"));
    chrome = spawn("/usr/bin/google-chrome", [
      "--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${dir}`, "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required", "about:blank",
    ], { stdio: "ignore" });
    let ok = false; for (let i = 0; i < 40 && !ok; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); ok = true; } catch { await sleep(250); } }
    if (!ok) throw new Error("chrome no abrió CDP");
    const c = await CDP.connect(PORT);

    // invitar minteando token dev (server local devAuth:true acepta token simple)
    const mint = await (await fetch(`${BASE}/api/invite`, { method: "POST", headers: { "content-type": "application/json", "x-admin-token": process.env.ADMIN_TOKEN || "dev-admin" }, body: JSON.stringify({ handle: "Ux1A", role: "attendee", hours: 2 }) })).text();
    let jwt = ""; try { jwt = JSON.parse(mint).invite ?? JSON.parse(mint).token ?? ""; } catch { jwt = ""; }
    const tid = await newTab(c, jwt ? `${ORIGIN}/?invite=${encodeURIComponent(jwt)}` : ORIGIN);
    if (!(await enter(c, tid, "Ux1A"))) throw new Error("Ux1A no entró");
    await sleep(3000);

    const res: any = {};
    res.mapBtn = await c.evalJS(tid, "!!document.getElementById('gr-mapbtn')");
    // click en el botón del mapa → overlay abierto con el minimapa dentro
    res.mapOpen = await c.evalJS(tid, "(() => { document.getElementById('gr-mapbtn')?.click(); const o=document.getElementById('gr-mapoverlay'); return {open: !!o?.classList.contains('gr-open'), dentro: !!o?.querySelector('canvas'), ancho: o?.querySelector('canvas')?.style?.width}; })()");
    await sleep(300);
    res.mapVisible = await c.evalJS(tid, "(() => { const o=document.getElementById('gr-mapoverlay'); return o ? getComputedStyle(o).display !== 'none' && parseFloat(getComputedStyle(o).opacity) > 0.5 : false; })()");
    // monocromo: botones con grayscale, Salir con color
    res.mono = await c.evalJS(tid, "(() => { const b=[...document.querySelectorAll('#gr-actionbar button')]; const ex=b.find(x=>x.textContent==='🚪'); return {total: b.length, filtro: getComputedStyle(b[0]).filter.slice(0,20), exitSinFiltro: ex ? !getComputedStyle(ex).filter.includes('grayscale') : false}; })()");
    // emojis: 🎭 abre paleta con 6, enviar cierra
    res.emojis = await c.evalJS(tid, `(() => { const btns=[...document.querySelectorAll('#gr-actionbar button')]; const mb=btns.find(x=>x.textContent==='🎭'); if(!mb) return {err:'sin 🎭'}; mb.click(); const p=document.getElementById('gr-emojipalette'); const n=p?p.querySelectorAll('button').length:0; const color=p?getComputedStyle(p.querySelector('button')).filter==='none':false; p?.querySelector('button')?.click(); const cerrada=!document.getElementById('gr-emojipalette'); return {nPaleta:n, aColor:color, cierraAlEnviar:cerrada}; })()`);
    // halos: ring por jugador
    await sleep(1500);
    res.halos = await c.evalJS(tid, "(() => { const s=window.__ns?.scene; const ps=[...(s?.players?.values()||[])]; return {jugadores: ps.length, conHalo: ps.filter(p=>p.roleHalo).length, alpha: ps.map(p=>+(+p.roleHalo?.strokeAlpha||0).toFixed(2)).slice(0,3)}; })()");
    console.log("=== VERIFICACIÓN CICLO 1 UX ===");
    for (const [k, v] of Object.entries(res)) console.log(k + ":", JSON.stringify(v));
  } finally {
    try { chrome?.kill(); } catch {}
  }
})();

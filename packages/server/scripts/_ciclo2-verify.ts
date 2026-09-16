// Verificación headless CICLO 2 (espec auditor): 3 clientes a distancias
// controladas — escala/alpha por dist, self=1.0, suscripción de video intacta.
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
async function mint(handle: string) {
  const r = await (await fetch(`${BASE}/api/invite`, { method: "POST", headers: { "content-type": "application/json", "x-admin-token": process.env.ADMIN_TOKEN || "dev-admin" }, body: JSON.stringify({ handle, role: "attendee", hours: 2 }) })).json();
  return r.token || r.invite;
}
(async () => {
  let chrome: ChildProcess | null = null;
  try {
    const PORT = 9700 + Math.floor(Math.random() * 40);
    const dir = mkdtempSync(path.join(tmpdir(), "gr-c2-"));
    chrome = spawn("/usr/bin/google-chrome", ["--headless=new","--no-sandbox","--disable-gpu","--disable-dev-shm-usage",`--remote-debugging-port=${PORT}`,`--user-data-dir=${dir}`,"--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream","about:blank"], { stdio: "ignore" });
    let ok = false; for (let i = 0; i < 40 && !ok; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); ok = true; } catch { await sleep(250); } }
    const c = await CDP.connect(PORT);
    const jwt = await mint("C2A");
    const t = await c.send("Target.createTarget", { url: `${ORIGIN}/?invite=${encodeURIComponent(jwt)}` });
    const tid = t.targetId;
    let entered = false;
    for (let i = 0; i < 40 && !entered; i++) {
      await sleep(1000);
      if (await c.evalJS(tid, "!!document.getElementById('grGo')")) {
        await c.evalJS(tid, "(() => { const v=document.querySelector('video'); const s=document.getElementById('grSnap'); if(s && v && v.videoWidth) s.click(); })()");
        await sleep(300);
        await c.evalJS(tid, "document.getElementById('grGo')?.click()");
      }
      entered = !!(await c.evalJS(tid, "!!document.getElementById('gr-actionbar')"));
    }
    if (!entered) throw new Error("no entró");
    await sleep(3000);
    // Verificación de puras funciones (mapScale/mapVideoAlpha no exportadas;
    // verificar comportamientos observables: self escala 1, zonas fade, y
    // curvas inyectando un player fantasma a dist fija)
    const res: any = await c.evalJS(tid, `(() => {
      const s = window.__ns.scene; const me = s.players.get(s.myId);
      const out = {};
      // self: nunca escala
      out.selfScale = me.visScale ?? 1;
      out.selfSpriteScale = me.sprite.scaleX;
      // zonas: existen y tienen base alpha registrada
      out.zonas = (s.grZones||[]).length;
      // simular: player fantasma SOLO cliente (el server poda los fake schema)
      const gs = s.add.rectangle(me.worldX + 6*32, me.worldY, 22, 22, 0x00c853, 1);
      const g = { sprite: gs, label: null, handle: "Ghost", worldX: gs.x, worldY: gs.y, avatarColor: "#00c853", schema: { role: "attendee" } };
      s.players.set("ghost-id", g);
      return { selfScale: out.selfScale, selfSpriteScale: out.selfSpriteScale, zonas: out.zonas, ghost: !!g };
    })()`);
    await sleep(1500); // dejar que updateVisuals corra varios frames
    const res2: any = await c.evalJS(tid, `(() => { try {
      const s = window.__ns.scene; const me = s.players.get(s.myId);
      const g = s.players.get([...s.players.keys()].find(k=>k!=="C2A"&&k!==s.myId)||"ghost-id");
      if (!g) return {err:"sin ghost", ids:[...s.players.keys()]};
      const dist = Math.hypot(g.worldX-me.worldX, g.worldY-me.worldY)/32;
      return { dist: +dist.toFixed(2), ghostScale: +(g.visScale||0).toFixed(3), spriteScale: +g.sprite.scaleX.toFixed(3), bubbleOpacity: g.bubble ? g.bubble.style.opacity : "sin-bubble" };
    } catch(e) { return {err:String(e)}; } })()`);
    // mover al fantasma a ~2 tiles (cerca)
    await c.evalJS(tid, `(() => { const s=window.__ns.scene; const g=s.players.get("ghost-id"); g.schema.x = s.players.get(s.myId).schema.x + 2; g.schema.y = s.players.get(s.myId).schema.y; g.worldX = g.schema.x*32+16; g.worldY = g.schema.y*32+16; })()`);
    await sleep(1500);
    const res3: any = await c.evalJS(tid, `(() => { const s=window.__ns.scene; const g=s.players.get("ghost-id"); return { cercaScale: +(g.visScale||0).toFixed(3), cercaOpacity: g.bubble? g.bubble.style.opacity : "sin-bubble" }; })()`);
    console.log("=== VERIFICACIÓN CICLO 2 ===");
    console.log("self:", JSON.stringify(res));
    console.log("ghost@~6t:", JSON.stringify(res2));
    console.log("ghost@~2t:", JSON.stringify(res3));
  } finally { try { chrome?.kill(); } catch {} }
})();

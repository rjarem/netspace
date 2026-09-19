// Gate 8.4 — clic derecho (plan auditor):
// (a) admin clic derecho sobre attendee → aparece #gr-ctxmenu con ⛔
// (b) clic derecho NO mueve el avatar (target del click-to-move no cambia)
// (c) moderator clic derecho sobre otro moderator → NO hay menú (mayTouch)
// (d) admin clic derecho sobre attendee → ⭐ promociona en vivo (mod:role aplica)
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BASE = process.env.BASE_URL || "http://localhost:2567";
const PLAY = process.env.PLAY_URL || "http://localhost:5173";
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, extra?: any) => { if (ok) { pass++; console.log(`PASS ${n}`); } else { fail++; console.log(`FAIL ${n} ${JSON.stringify(extra || "")}`); } };

class CDP {
  ws!: import("ws").WebSocket; private id = 0; private pending = new Map<number, (m: any) => void>();
  sessions = new Map<string, string>();
  static async connect(port: number) {
    const c = new CDP();
    const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const { WebSocket } = await import("ws");
    c.ws = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((res, rej) => { c.ws.onopen = res as any; c.ws.onerror = rej as any; });
    c.ws.onmessage = (ev) => { if (typeof ev.data !== "string") return; const m = JSON.parse(ev.data); if (m.id && c.pending.has(m.id)) { const fn = c.pending.get(m.id)!; c.pending.delete(m.id); fn(m); } };
    return c;
  }
  send(method: string, params: any = {}, sessionId?: string) {
    const id = ++this.id;
    return new Promise<any>((res, rej) => { this.pending.set(id, (m) => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)); this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  }
  async evalJS(tid: string, expr: string) {
    if (!this.sessions.has(tid)) { const { sessionId } = await this.send("Target.attachToTarget", { targetId: tid, flatten: true }); this.sessions.set(tid, sessionId); }
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, this.sessions.get(tid));
    return (r as any)?.result?.value ?? null;
  }
  async rightClickAt(tid: string, sx: number, sy: number) {
    if (!this.sessions.has(tid)) { const { sessionId } = await this.send("Target.attachToTarget", { targetId: tid, flatten: true }); this.sessions.set(tid, sessionId); }
    const sid = this.sessions.get(tid)!;
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x: sx, y: sy, button: "right", buttons: 2, clickCount: 1 }, sid);
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: sx, y: sy, button: "right", buttons: 0, clickCount: 1 }, sid);
  }
}
let chrome: ChildProcess | null = null;
const mintInvite = async (role: string) => (await (await fetch(BASE + "/api/invite", { method: "POST", headers: { "x-admin-token": "dev-admin", "Content-Type": "application/json" }, body: JSON.stringify({ role, hours: 1 }) })).json()).token;
const startChrome = async () => {
  const PORT = 9900 + Math.floor(Math.random() * 40);
  const dir = mkdtempSync(path.join(tmpdir(), "gr-84-"));
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
    const adminTid = await enterPage(c, "admin", "Gate84Admin");
    const modTid = await enterPage(c, "moderator", "Gate84Mod");
    const attTid = await enterPage(c, "attendee", "Gate84Att");
    await sleep(2500);

    // coordenadas del attendee en pantalla del admin + su target actual
    // (para el gate: recoloco el CONTAINER local del attendee junto al admin —
    // el picking del clic derecho lee coordenadas locales de la escena)
    const pos = await c.evalJS(adminTid, `(() => {
      const sc = window.__ns.scene;
      let me = null; sc.players.forEach((ui, id) => { if (id === sc.myId) me = ui; });
      let found = null;
      sc.players.forEach((ui, id) => { if (ui.handle === "Gate84Att") found = ui; });
      if (!found || !me) return null;
      found.sprite.x = me.sprite.x + 32;
      found.sprite.y = me.sprite.y;
      const px = found.sprite.x, py = found.sprite.y;
      const cam = sc.cameras.main;
      const sx = Math.round((px - cam.worldView.x) * cam.zoom);
      const sy = Math.round((py - cam.worldView.y) * cam.zoom);
      const tgt = sc.target || null;
      return { sx, sy, tgtBefore: tgt ? { x: tgt.x, y: tgt.y } : null };
    })()`);
    if (!pos) { console.log("FAIL 8.4-setup attendee no visible"); process.exit(1); }

    // (b primero: clic derecho NO mueve) — registrar target después del right-click
    // (reintento: el primer right-click headless a veces lo come el menú nativo)
    let after: any = null;
    for (let t = 0; t < 3 && !(after?.menu); t++) {
      await c.rightClickAt(adminTid, pos.sx, pos.sy);
      await sleep(800);
      after = await c.evalJS(adminTid, `(() => { const sc=window.__ns.scene; const m=document.getElementById('gr-ctxmenu'); return { menu: !!m, hasBan: m ? m.textContent.includes("⛔") : false, hasMute: m ? m.textContent.includes("🙊") : false, tgt: sc.target ? {x:sc.target.x,y:sc.target.y} : null }; })()`);
    }
    check("8.4-a clic derecho sobre attendee → menú con ⛔", !!(after?.menu && after?.hasBan), after);
    const moved = after?.tgt && pos.tgtBefore && (after.tgt.x !== pos.tgtBefore.x || after.tgt.y !== pos.tgtBefore.y);
    check("8.4-b clic derecho NO mueve el avatar (click-to-move intacto)", !moved, { tgtBefore: pos.tgtBefore, tgtAfter: after?.tgt });

    // (c) moderator clic derecho sobre ADMIN → sin menú (mayTouch espejado).
    // CICLO 10 (harness): ya NO teleportamos sprites (el tween de
    // onServerPosition y el empuje nuevo los reacomodan — fuente de flakes).
    // En su lugar: ocultar a todos menos el admin (killTweens + fuera de
    // cámara) y hacer right-click en la posición REAL del sprite del admin.
    const posAdmin = await c.evalJS(modTid, `(() => {
      const sc = window.__ns.scene;
      let found = null;
      sc.players.forEach((ui, id) => {
        if (id === sc.myId) { sc.tweens.killTweensOf([ui.sprite, ui.label, ui.sprite.faceRef].filter(Boolean)); return; }
        if (ui.handle === "Gate84Admin") { found = ui; return; }
        sc.tweens.killTweensOf([ui.sprite, ui.label, ui.sprite.faceRef].filter(Boolean));
        ui.sprite.y = -99999; ui.label.y = -99999;
      });
      if (!found) return null;
      const cam = sc.cameras.main;
      return { sx: Math.round((found.sprite.x - cam.worldView.x) * cam.zoom), sy: Math.round((found.sprite.y - cam.worldView.y) * cam.zoom),
               tx: Math.floor(found.sprite.x / 32), ty: Math.floor(found.sprite.y / 32) };
    })()`);
    if (posAdmin) {
      // el right-click headless a veces lo come el menú nativo (lección de
      // (a)) → reintentar; la aserción exige que NUNCA abra.
      let opened = false, simRole: any = null;
      for (let t = 0; t < 3 && !opened; t++) {
        await c.rightClickAt(modTid, posAdmin.sx, posAdmin.sy);
        await sleep(600);
        const st = await c.evalJS(modTid, `(() => {
          const sc = window.__ns.scene;
          const m = document.getElementById('gr-ctxmenu');
          // hit real: mismo test que main.ts hace con el pointer
          let hit = null;
          sc.players.forEach((ui, id) => {
            if (id === sc.myId) return;
            const px = Math.floor(ui.sprite.x / 32), py = Math.floor(ui.sprite.y / 32);
            if (px === ${posAdmin.tx} && py === ${posAdmin.ty}) hit = ui.role;
          });
          return { noMenu: !m, hit };
        })()`);
        simRole = st?.hit ?? simRole;
        if (st?.noMenu === false) opened = true;
      }
      check("8.4-c moderator sobre admin → SIN menú (mayTouch espejado)", opened === false && simRole === "admin", { opened, simRole });
    } else check("8.4-c moderator sobre admin → SIN menú (mayTouch espejado)", false, "admin no visible — aserción fuerte no ejecutable (OCR fix: no PASS trivial)");

    // (d) desde el menú: ⭐ promociona (vía userlist-click sim o menú directo)
    // cerrar menú previo y reabrir
    await c.evalJS(adminTid, "document.getElementById('gr-ctxmenu')?.remove()");
    // CICLO 10: re-teleportar el sprite del attendee junto al admin (el push
    // pudo mover su posición server durante b/c y el clic del setup ya no le pega).
    const posD = await c.evalJS(adminTid, `(() => {
      const sc = window.__ns.scene;
      let me = null, found = null;
      sc.players.forEach((ui, id) => { if (id === sc.myId) me = ui; else if (ui.handle === "Gate84Att") found = ui; });
      if (!me || !found) return null;
      sc.tweens.killTweensOf([found.sprite, found.label, found.sprite.faceRef].filter(Boolean));
      found.sprite.x = me.sprite.x + 32; found.sprite.y = me.sprite.y;
      found.label.x = found.sprite.x; found.label.y = found.sprite.y - 32;
      const cam = sc.cameras.main;
      return { sx: Math.round((found.sprite.x - cam.worldView.x) * cam.zoom), sy: Math.round((found.sprite.y - cam.worldView.y) * cam.zoom) };
    })()`);
    // OCR fix: si posD es null (eval lanzó o el attendee no está), fallar
    // explícito en vez de degradar silenciosamente a coordenadas viejas.
    if (!posD) check("8.4-d setup: attendee re-posicionado visible", false, { posD });
    const clickAt = posD || pos;
    await c.rightClickAt(adminTid, clickAt.sx, clickAt.sy);
    await sleep(600);
    const dbgD = await c.evalJS(adminTid, `(() => {
      const sc = window.__ns.scene; const m = document.getElementById('gr-ctxmenu');
      let att = null, meP = null;
      sc.players.forEach((ui, id) => { if (ui.handle === "Gate84Att") att = ui; else if (id === sc.myId) meP = ui; });
      return { menu: !!m, att: att ? { x: Math.round(att.sprite.x), y: Math.round(att.sprite.y), sx: att.schema?.x, sy: att.schema?.y } : null,
               me: meP ? { x: Math.round(meP.sprite.x), y: Math.round(meP.sprite.y), sx: meP.schema?.x, sy: meP.schema?.y } : null };
    })()`);
    console.log("DBG 8.4-d:", JSON.stringify(dbgD));
    // reintento (misma lección de (a)): el primer right-click a veces lo come
    // el menú nativo → hasta 3 intentos hasta que el menú aparezca.
    let promoted: any = "no-menu";
    for (let t = 0; t < 3 && promoted === "no-menu"; t++) {
      await c.rightClickAt(adminTid, clickAt.sx, clickAt.sy);
      await sleep(600);
      promoted = await c.evalJS(adminTid, `(() => {
        const m = document.getElementById('gr-ctxmenu');
        if (!m) return "no-menu";
        const b=[...m.querySelectorAll("button")].find(x=>(x.textContent||"").includes("⭐"));
        if (!b) return "no-star";
        b.click();
        return "clicked";
      })()`);
    }
    let roleChanged = false;
    for (let i = 0; i < 10 && !roleChanged; i++) { await sleep(1000); roleChanged = !!(await c.evalJS(adminTid, `(() => { let f=false; window.__ns.scene.players.forEach((ui)=>{ if(ui.handle==="Gate84Att" && ui.role==="moderator") f=true; }); return f; })()`)); }
    check("8.4-d menú → ⭐ promociona attendee a moderator EN VIVO", promoted === "clicked" && roleChanged, { promoted, roleChanged });
  } finally { killChrome(); }
  console.log(`---- gate-8.4: ${pass} PASS / ${fail} FAIL ----`);
  process.exit(fail ? 1 : 0);
};
main().catch(e => { killChrome(); console.error("gate error:", e.message); process.exit(1); });

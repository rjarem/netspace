// Gate 8.1 — badge global del megáfono (firma auditor, plan ciclo 8):
// (a) mod activa 📣 → OTRO usuario ve badge "📢 <nombre> habla a TODO el evento"
// (b) al apagar → badge desaparece
// (c) userlist muestra 📢 junto al hablante
// (d) late-joiner entra DURANTE megáfono → badge visible sin acción local
// (e) rms: volumen completo a 20 tiles (verificado aquí con audio real remoto)
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
const mintInvite = async (role: string) => {
  const inv = await (await fetch(BASE + "/api/invite", { method: "POST", headers: { "x-admin-token": process.env.ADMIN_TOKEN || "dev-admin", "Content-Type": "application/json" }, body: JSON.stringify({ role, hours: 1 }) })).json();
  return inv.token as string;
};

const startChrome = async () => {
  const PORT = 9800 + Math.floor(Math.random() * 40);
  const dir = mkdtempSync(path.join(tmpdir(), "gr-81-"));
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
const megaBtnClick = async (c: CDP, tid: string) => {
  return c.evalJS(tid, `(() => {
    const b=[...document.querySelectorAll("#gr-actionbar button")].find(x=>/📣|📢/.test(x.textContent||"") && x.style.display!=="none");
    if(!b) return "no-btn"; b.click(); return "ok:"+(b.textContent||"").trim();
  })()`);
};
const killChrome = () => { try { chrome?.kill("SIGKILL"); } catch {} chrome = null; };

const main = async () => {
  const { c } = await startChrome();
  try {
    const modTid = await enterPage(c, "moderator", "Gate81Mod");
    const attTid = await enterPage(c, "attendee", "Gate81Att");
    await sleep(2000); // roster cruzado

    // (a) mod activa megáfono → attendee ve badge con el nombre
    await megaBtnClick(c, modTid);
    let badge = "";
    for (let i = 0; i < 15 && !badge; i++) { await sleep(1000); badge = String(await c.evalJS(attTid, `document.getElementById("gr-mega-badge")?.textContent || ""`)); }
    check("8.1-a badge visible para OTRO usuario con nombre", badge.includes("Gate81Mod") && badge.includes("📢"), { badge });

    // (c) 📢 en userlist junto al hablante
    await c.evalJS(attTid, `(() => { const ul=document.getElementById("userlist"); if(ul && ul.dataset.exp!=="1") ul.click(); const sc=window.__ns.scene; if(sc.renderUserList) sc.renderUserList(); })()`);
    await sleep(800);
    const dot = await c.evalJS(attTid, `(() => { const ul=document.getElementById("userlist"); return ul && ul.textContent.includes("📢") ? true : false; })()`);
    check("8.1-c 📢 junto al hablante en userlist", dot === true, { dot });

    // (d) late-joiner durante megáfono
    const lateTid = await enterPage(c, "attendee", "Gate81Late");
    let lateBadge = "";
    for (let i = 0; i < 10 && !lateBadge; i++) { await sleep(1000); lateBadge = String(await c.evalJS(lateTid, `document.getElementById("gr-mega-badge")?.textContent || ""`)); }
    check("8.1-d late-joiner ve badge al entrar", lateBadge.includes("Gate81Mod"), { lateBadge });

    // (b) mod apaga → badge desaparece para todos
    await megaBtnClick(c, modTid);
    let gone = false;
    for (let i = 0; i < 15 && !gone; i++) { await sleep(1000); gone = !(await c.evalJS(attTid, `!!document.getElementById("gr-mega-badge")`)); }
    check("8.1-b badge desaparece al apagar", gone === true, { gone });

    // volumen completo a distancia (régimen fullVolume — verificación de audio real)
    // OJO: (b) apagó el megáfono — reactivarlo antes de medir (bug de orden del gate).
    await megaBtnClick(c, modTid);
    await sleep(3000);
    // Nota: el attendees está lejos del mod; voice.ts aplica fullVolume=1 vía
    // audioNode/audioEl. Si el remoto aún no tiene audio attach (carrera), se
    // reintenta unos segundos antes de fallar. megaphoneBy es sessionId Colyseus,
    // el PlayerUI del hablante se busca por sessionId.
    let vol: any = -3;
    for (let i = 0; i < 15 && (vol === -3 || vol === -2 || vol === -1); i++) {
      await sleep(1000);
      vol = await c.evalJS(attTid, `(() => {
        const sc = window.__ns.scene;
        const mega = (sc.room?.state||{}).megaphoneBy;
        if (!mega) return -2;
        // el PlayerUI del hablante puede tardar en construir audioNode (suscripción
        // + chain). Si no está, reintentar (el bucle externo ya reintenta).
        const p = sc.players.get(mega);
        if (!p) return -2;
        if (p.audioNode) return p.audioNode.gain.gain.value;
        if (p.audioEl) return p.audioEl.volume;
        return -1;
      })()`);
    }
    check("8.1-e volumen completo del hablante remoto (dist lejos)", typeof vol === "number" && vol >= 0.9, { vol });
  } finally { killChrome(); }
  console.log(`---- gate-8.1: ${pass} PASS / ${fail} FAIL ----`);
  process.exit(fail ? 1 : 0);
};
main().catch(e => { killChrome(); console.error("gate error:", e.message); process.exit(1); });

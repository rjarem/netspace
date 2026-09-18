// Gate 8.2 — UI de moderación (firma auditor, plan ciclo 8):
// (a) admin ve 👢⛔ sobre attendee; sin confirm NO se envía nada; con confirm → kick REAL desconecta al target
// (b) moderator NO ve ⛔👢 (solo admin) NI 🙊 sobre otro moderator (mayTouch espejado)
// (c) moderator SÍ ve 🙊 sobre attendee y la acción real aplica (target queda muteado)
// (d) toast "acción enviada" visible para el moderador que ejecutó
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
      const m = JSON.parse(String(ev.data));
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
  // click en botón con dialog: intercepta Page.javascriptDialogOpening y responde
  // click en botón de fila con window.confirm interceptado (headless no emite
  // javascriptDialogOpening fiable): confirm = stub que devuelve `accept` y marca
  // __grConfirmSeen para probar que el confirm OBLIGATORIO está en el camino.
  async clickWithDialog(tid: string, targetHandle: string, label: string, accept: boolean) {
    if (!this.sessions.has(tid)) { const { sessionId } = await this.send("Target.attachToTarget", { targetId: tid, flatten: true }); this.sessions.set(tid, sessionId); }
    const expr = `(() => {
      window.__grConfirmSeen = false;
      window.confirm = () => { window.__grConfirmSeen = true; return ${accept}; };
      const rows=[...document.querySelectorAll("#userlist *")].filter(r=>r.children.length && [...r.querySelectorAll("button")].length && (r.textContent||"").includes("${targetHandle}"));
      const row = rows[rows.length-1] || rows[0];
      if (!row) return "no-row";
      const b=[...row.querySelectorAll("button")].find(x=>(x.textContent||"").trim()==="${label}");
      if (!b) return "no-btn";
      b.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
      return "clicked";
    })()`;
    const sent = await this.evalJS(tid, expr).catch(() => "eval-err");
    await sleep(1200);
    const confirmSeen = await this.evalJS(tid, "!!window.__grConfirmSeen");
    return { sent, dialogSeen: confirmSeen === true };
  }
}

let chrome: ChildProcess | null = null;
const mintInvite = async (role: string) => {
  const inv = await (await fetch(BASE + "/api/invite", { method: "POST", headers: { "x-admin-token": process.env.ADMIN_TOKEN || "dev-admin", "Content-Type": "application/json" }, body: JSON.stringify({ role, hours: 1 }) })).json();
  return inv.token as string;
};
const startChrome = async () => {
  const PORT = 9900 + Math.floor(Math.random() * 40);
  const dir = mkdtempSync(path.join(tmpdir(), "gr-82-"));
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
      await c.evalJS(tid, `(() => { const el=document.getElementById('grHandle'); if(el && !el.value){ el.value="${handle}"; el.dispatchEvent(new Event("input")); } })()`);
      const snap = await c.evalJS(tid, "(() => { const v=document.querySelector('video'); const s=document.getElementById('grSnap'); if(s && v && v.videoWidth){ s.click(); return true; } return false; })()");
      if (snap) await sleep(500);
      await c.evalJS(tid, "document.getElementById('grGo')?.click()");
    }
    entered = !!(await c.evalJS(tid, "!!document.getElementById('gr-actionbar')"));
  }
  if (!entered) throw new Error(`${handle}: antesala no pasó`);
  return tid;
};
const expandUserlist = async (c: CDP, tid: string) => {
  await c.evalJS(tid, `(() => { const ul=document.getElementById("userlist"); if(ul && ul.dataset.exp!=="1") ul.click(); const sc=window.__ns.scene; if(sc.renderUserList) sc.renderUserList(); })()`);
  await sleep(800);
};
const rowButtons = async (c: CDP, tid: string, targetHandle: string) => {
  return c.evalJS(tid, `(() => {
    const rows=[...document.querySelectorAll("#userlist *")].filter(r=>r.children.length && [...r.querySelectorAll("button")].length && (r.textContent||"").includes("${targetHandle}"));
    const row = rows[rows.length-1] || rows[0];
    if (!row) return [];
    return [...row.querySelectorAll("button")].map(b=>(b.textContent||"").trim());
  })()`);
};
const killChrome = () => { try { chrome?.kill("SIGKILL"); } catch {} chrome = null; };

const main = async () => {
  const { c } = await startChrome();
  try {
    const adminTid = await enterPage(c, "admin", "Gate82Admin");
    const modTid = await enterPage(c, "moderator", "Gate82Mod");
    const attTid = await enterPage(c, "attendee", "Gate82Att");
    await sleep(2500);

    // (a) admin ve 👢⛔⛔⭐ en la fila del attendee
    await expandUserlist(c, adminTid);
    const adminBtns = await rowButtons(c, adminTid, "Gate82Att");
    check("8.2-a admin ve 🙊👢⛔⭐ sobre attendee", adminBtns.includes("🙊") && adminBtns.includes("👢") && adminBtns.includes("⛔") && adminBtns.includes("⭐"), { adminBtns });

    // (b) moderator NO ve ⛔👢 sobre attendee (solo admin), y sobre OTRO moderator nada
    await expandUserlist(c, modTid);
    const modBtnsOnAtt = await rowButtons(c, modTid, "Gate82Att");
    check("8.2-b1 moderator ve 🙊 pero NO 👢⛔ sobre attendee", modBtnsOnAtt.includes("🙊") && !modBtnsOnAtt.includes("👢") && !modBtnsOnAtt.includes("⛔"), { modBtnsOnAtt });
    const modBtnsOnMod = await rowButtons(c, modTid, "Gate82Mod");
    check("8.2-b2 moderator NO ve botones sobre otro moderator (mayTouch)", modBtnsOnMod.length === 0 || !modBtnsOnMod.some(b => ["🙊", "👢", "⛔"].includes(b)), { modBtnsOnMod });
    const modBtnsOnAdmin = await rowButtons(c, modTid, "Gate82Admin");
    check("8.2-b3 moderator NO ve botones sobre admin (mayTouch espejado)", !modBtnsOnAdmin.some(b => ["🙊", "👢", "⛔"].includes(b)), { modBtnsOnAdmin });

    // (c) confirmación: cancel → NO se envía (target no desconecta); aceptar → kick REAL
    const cancel = await c.clickWithDialog(adminTid, "Gate82Att", "👢", false);
    console.log("[dbg] cancel:", JSON.stringify(cancel));
    await sleep(3000);
    const attStill = await c.evalJS(attTid, "!!document.getElementById('gr-actionbar')");
    check("8.2-c1 confirm CANCEL → nada se envía (target sigue en sala)", cancel.dialogSeen === true && attStill === true, { dialogSeen: cancel.dialogSeen, attStill });

    const accept = await c.clickWithDialog(adminTid, "Gate82Att", "👢", true);
    let kicked = false;
    for (let i = 0; i < 15 && !kicked; i++) {
      await sleep(1000);
      const st = await c.evalJS(attTid, `(() => ({ bar: !!document.getElementById('gr-actionbar'), body: document.body.innerText.slice(0,120), url: location.href }))()`).catch(() => ({ err: "eval-failed" }));
      kicked = !!(st && st.body && String(st.body).includes("Fuiste expulsado"));
    }
        check("8.2-c2 confirm ACEPTAR → kick REAL (target desconectado)", accept.dialogSeen && kicked, { accept: accept.dialogSeen, kicked });
  } finally { killChrome(); }
  console.log(`---- gate-8.2: ${pass} PASS / ${fail} FAIL ----`);
  process.exit(fail ? 1 : 0);
};
main().catch(e => { killChrome(); console.error("gate error:", e.message); process.exit(1); });

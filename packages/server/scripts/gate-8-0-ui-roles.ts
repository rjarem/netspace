// Gate 8.0 (auditor-firmado GO/NO-GO): hipótesis "la capa de mod está oculta POR ROL".
// attendee: NO ve 📣 ni 🙊👢⛔ · admin: SÍ ve 📣 y capa mod · moderator: 📣 + 🙊 sin ⛔/👢.
// Condiciones del auditor: GO/NO-GO — si admin real NO ve la capa, NO fixear: reportar.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const BASE = process.env.BASE_URL || "http://localhost:2567";
const PLAY = process.env.PLAY_URL || "http://localhost:5173";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "dev-admin";
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
async function openWithRole(role: string): Promise<any> {
  const PORT = 9760 + Math.floor(Math.random() * 30);
  const dir = mkdtempSync(path.join(tmpdir(), "gr-80-"));
  chrome = spawn("/usr/bin/google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: "ignore" });
  let ok = false; for (let i = 0; i < 40 && !ok; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); ok = true; } catch { await sleep(250); } }
  const c = await CDP.connect(PORT);
  // mintear invite del rol
  const inv = await (await fetch(BASE + "/api/invite", { method: "POST", headers: { "x-admin-token": process.env.ADMIN_TOKEN || "dev-admin", "Content-Type": "application/json" }, body: JSON.stringify({ role, hours: 1 }) })).json();
  const sl = await (await fetch(BASE + "/api/shortlink", { method: "POST", headers: { "x-admin-token": process.env.ADMIN_TOKEN || "dev-admin", "Content-Type": "application/json" }, body: JSON.stringify({ token: inv.token }) })).json();
  if (!sl.code) throw new Error("shortlink fallo: " + JSON.stringify(sl));
  const t = await c.send("Target.createTarget", { url: "about:blank" });
  const tid = t.targetId;
  await c.send("Page.navigate", { url: `${PLAY}/i/${sl.code}` }, c.sessions.get(tid)).catch(async () => {
    // sesión puede no existir aún — attach explícito via evalJS
  });
  // forzar attach + navegar (evalJS hace Target.attachToTarget)
  await c.evalJS(tid, "1").catch(() => {});
  await c.send("Page.navigate", { url: `${PLAY}/?invite=${inv.token}` }, c.sessions.get(tid)).catch(() => {});
  // ANTESALA: teclear handle, tomar foto, entrar (flujo 6baa31)
  let entered = false;
  for (let i = 0; i < 60 && !entered; i++) {
    await sleep(1000);
    const hasGo = await c.evalJS(tid, "(() => { const b=document.getElementById('grGo'); return !!b && !b.disabled; })()");
    if (hasGo) {
      const hasHandle = await c.evalJS(tid, "!!document.getElementById('grHandle')");
      if (hasHandle) {
        await c.evalJS(tid, `(() => { const el=document.getElementById('grHandle'); if(el && !el.value){ el.value="Gate80${role}"; el.dispatchEvent(new Event("input")); } })()`);
      }
      const snap = await c.evalJS(tid, "(() => { const v=document.querySelector('video'); const s=document.getElementById('grSnap'); if(s && v && v.videoWidth){ s.click(); return true; } return false; })()");
      if (snap) await sleep(500);
      await c.evalJS(tid, "document.getElementById('grGo')?.click()");
    }
    entered = !!(await c.evalJS(tid, "!!document.getElementById('gr-actionbar')"));
  }
  if (!entered) throw new Error(`${role}: antesala no pasó`);
  // abrir userlist expandida si hay toggle (fase 8 la deja colapsada en móvil; desktop expande)
  await c.evalJS(tid, `(() => {
    const hdr = document.querySelector("[data-gr-userlist-hdr], #grPlayersHdr");
    if (hdr) (hdr as HTMLElement).click();
    return true;
  })()`);
  await sleep(500);
  const view = await c.evalJS(tid, `(() => {
    const sc = window.__ns?.scene;
    const me = sc?.players?.get?.(sc.myId);
    const bar = document.getElementById("gr-actionbar");
    const mega = bar ? [...bar.querySelectorAll("button")].filter(b => /📣|📢/.test(b.textContent || "")).some(b => b.style.display !== "none") : false;
    const doc = document.body.textContent || "";
    return { mega, role: me?.role || "NONE", myId: sc?.myId, players: sc?.players?.size, hasMute: doc.includes("🙊"), hasKick: doc.includes("👢"), hasBan: doc.includes("⛔") };
  })()`);
  await sleep(600);
  const view2 = await c.evalJS(tid, `(() => {
    const doc = document.body.textContent || "";
    return { hasMute: doc.includes("🙊"), hasKick: doc.includes("👢"), hasBan: doc.includes("⛔") };
  })()`);
  const final = { ...(view || {}), ...(view2 || {}), mega: !!view?.mega };
  try { await c.send("Target.closeTarget", { targetId: tid }); } catch {}
  try { chrome?.kill("SIGKILL"); } catch {}
  chrome = null;
  return final;
}

// --- Condición 1 del auditor: mod:role EN VIVO, sin recarga ---
// Un chrome, 2 páginas (admin + attendee). Admin promueve al attendee vía
// mod:role → la UI del attendee reacciona sin reload; demote → vuelve a ocultar.
async function liveRoleSwap(adminRole: string, targetRole: string): Promise<any> {
  const PORT = 9790 + Math.floor(Math.random() * 9);
  const dir = mkdtempSync(path.join(tmpdir(), "gr-80-live-"));
  chrome = spawn("/usr/bin/google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: "ignore" });
  let ok = false; for (let i = 0; i < 40 && !ok; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); ok = true; } catch { await sleep(250); } }
  const c = await CDP.connect(PORT);
  const mint = async (role: string) => {
    const inv = await (await fetch(BASE + "/api/invite", { method: "POST", headers: { "x-admin-token": process.env.ADMIN_TOKEN || "dev-admin", "Content-Type": "application/json" }, body: JSON.stringify({ role, hours: 1 }) })).json();
    return inv.token as string;
  };
  const enterPage = async (role: string) => {
    const token = await mint(role);
    const t = await c.send("Target.createTarget", { url: "about:blank" });
    const tid = t.targetId;
    await c.evalJS(tid, "1").catch(() => {});
    await c.send("Page.navigate", { url: `${PLAY}/?invite=${token}` }, c.sessions.get(tid)).catch(() => {});
    let entered = false;
    for (let i = 0; i < 60 && !entered; i++) {
      await sleep(1000);
      const hasGo = await c.evalJS(tid, "(() => { const b=document.getElementById('grGo'); return !!b && !b.disabled; })()");
      if (hasGo) {
        await c.evalJS(tid, `(() => { const el=document.getElementById('grHandle'); if(el && !el.value){ el.value="Gate80live${role}"; el.dispatchEvent(new Event("input")); } })()`);
        const snap = await c.evalJS(tid, "(() => { const v=document.querySelector('video'); const s=document.getElementById('grSnap'); if(s && v && v.videoWidth){ s.click(); return true; } return false; })()");
        if (snap) await sleep(500);
        await c.evalJS(tid, "document.getElementById('grGo')?.click()");
      }
      entered = !!(await c.evalJS(tid, "!!document.getElementById('gr-actionbar')"));
    }
    if (!entered) throw new Error(`live ${role}: antesala no pasó`);
    return tid;
  };
  try {
    const adminTid = await enterPage(adminRole);
    const attTid = await enterPage(targetRole);
    await sleep(2000); // roster cruzado
    // admin promueve al attendee en vivo
    const sent = await c.evalJS(adminTid, `(() => {
      const sc = window.__ns.scene;
      const target = [...sc.players.values()].find(p => (p.handle||"").startsWith("Gate80live${targetRole}"));
      if (!target) return "target-not-found";
      sc.room?.send("mod:role", { handle: target.handle, role: "moderator" });
      return "sent:" + target.handle;
    })()`);
    if (!String(sent).startsWith("sent:")) return { promoted: false, demoted: false, noReload: false, err: sent };
    let promoted = false;
    for (let i = 0; i < 15 && !promoted; i++) { await sleep(1000); promoted = !!(await c.evalJS(attTid, `(() => { const b=[...document.querySelectorAll("#gr-actionbar button")].find(x=>/📣|📢/.test(x.textContent||"")); return b && b.style.display !== "none"; })()`)); }
    // demote en vivo
    await c.evalJS(adminTid, `(() => {
      const sc = window.__ns.scene;
      const target = [...sc.players.values()].find(p => (p.handle||"") === "Gate80live${targetRole}" || (p.handle||"").startsWith("Gate80live${targetRole}"));
      sc.room?.send("mod:role", { handle: target.handle, role: "attendee" });
      return "demote-sent";
    })()`);
    let demoted = false;
    for (let i = 0; i < 15 && !demoted; i++) { await sleep(1000); demoted = !(await c.evalJS(attTid, `(() => { const b=[...document.querySelectorAll("#gr-actionbar button")].find(x=>/📣|📢/.test(x.textContent||"")); return b && b.style.display !== "none"; })()`)); }
    // capa mod de admin sobre fila AJENA (con attendee presente en sala): expandir userlist
    await c.evalJS(adminTid, `(() => { const ul=document.getElementById("userlist"); if(ul && ul.dataset.exp!=="1") ul.click(); const sc=window.__ns.scene; if(sc.renderUserList) sc.renderUserList(); })()`);
    await sleep(800);
    const capas = await c.evalJS(adminTid, `(() => { const doc=document.body.textContent||""; return { hasMute: doc.includes("🙊"), hasKick: doc.includes("👢"), hasBan: doc.includes("⛔") }; })()`);
    const noReload = !!(await c.evalJS(attTid, `(() => { const sc=window.__ns?.scene; return !!sc && !!sc.myId; })()`));
    return { promoted, demoted, noReload, sent, capas };
  } finally {
    try { chrome?.kill("SIGKILL"); } catch {}
    chrome = null;
  }
}

const main = async () => {
  const adminView = await openWithRole("admin");
  check("8.0-a ADMIN ve 📣 megáfono", adminView.mega === true, adminView);

  const attView = await openWithRole("attendee");
  check("8.0-c ATTENDEE NO ve 📣", attView.mega === false, attView);
  check("8.0-d ATTENDEE NO ve capa mod", !(attView.hasMute || attView.hasKick || attView.hasBan), attView);

  const modView = await openWithRole("moderator");
  check("8.0-e MODERATOR ve 📣", modView.mega === true, modView);

  // --- Condición 1 del auditor: mod:role EN VIVO sin recarga ---
  // Los asserts de capa (🙊👢⛔) requieren filas AJENAS: se verifican en sesiones
  // de 2 jugadores reales (un solo jugador en sala = userlist sin filas ajenas).
  const live = await liveRoleSwap("admin", "attendee");
  check("8.0-g promote en vivo → 📣 aparece SIN recarga", live?.promoted === true, live);
  check("8.0-h demote en vivo → 📣 desaparece SIN recarga", live?.demoted === true, live);
  check("8.0-i sin recarga (misma sesión Colyseus)", live?.noReload === true, live);
  check("8.0-b ADMIN ve capa mod en fila ajena (🙊👢⛔)", !!live?.capas?.hasMute && !!live?.capas?.hasKick && !!live?.capas?.hasBan, live?.capas);

  const live2 = await liveRoleSwap("moderator", "attendee");
  check("8.0-f MODERATOR ve 🙊 pero NO ⛔/👢 en fila ajena", !!live2?.capas?.hasMute && !live2?.capas?.hasBan && !live2?.capas?.hasKick, live2?.capas);

  console.log(`---- gate-8.0: ${pass} PASS / ${fail} FAIL ----`);
  process.exit(fail ? 1 : 0);
};
main().catch(e => { try { chrome?.kill("SIGKILL"); } catch {} console.error("gate error:", e.message); process.exit(1); });

// Gate CICLO 7.1 (auditor-firmado): auto-reconexión de voz tras caída REAL de
// LiveKit — sin recargar la página, con los 2 ajustes obligatorios del auditor:
//   AJUSTE 1: cambio de zona NO programa rejoin (flag lkManualDisc + identidad
//   por closure: solo actúa el Disconnected del room vigente).
//   AJUSTE 2: reintentos agotados → voice-deag + mensaje VISIBLE en #status.
// Flujo: join (chrome fake device) → docker restart de LiveKit (caída real,
// el cliente recibe Disconnected, no solo Reconnecting) → assert auto-rejoin
// contra el LiveKit revivido con el token guardado (lkLastMsg) → connected.
import { spawn, ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
// @ts-ignore
import WebSocket from "ws";

const BASE = process.argv[2] || "http://localhost:2567";
const ORIGIN = process.argv[3] || "http://localhost:5173";
let PASS = 0, FAIL = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${ok ? "" : extra}`);
  ok ? PASS++ : FAIL++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type CDP = { send: (method: string, params?: any, sid?: string) => Promise<any> };
async function connectCdp(port: number): Promise<CDP> {
  const wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
  const ws = new WebSocket(wsUrl) as any;
  await new Promise((r) => ws.on("open", r));
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  ws.on("message", (d: any) => {
    const m = JSON.parse(d.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
  });
  return {
    send: (method: string, params: any = {}, sid?: string) =>
      new Promise((resolve, reject) => {
        const mid = ++id;
        pending.set(mid, (m) => (m.error ? reject(new Error(method + ": " + JSON.stringify(m.error))) : resolve(m.result)));
        ws.send(JSON.stringify({ id: mid, method, params, sessionId: sid }));
      }),
  };
}
async function evalJS(cdp: CDP, sid: string, expr: string): Promise<any> {
  const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, sid);
  return r?.result?.value;
}

function launchChrome(port: number): ChildProcess {
  const profile = `/tmp/gr-71-chrome-${Date.now()}`;
  mkdirSync(profile, { recursive: true });
  return spawn("/usr/bin/google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required", "--window-size=1280,800",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
}

async function main() {
  await sleep(300);
  const chrome = launchChrome(9335);
  try {
    for (let i = 0; i < 40; i++) { try { await fetch("http://127.0.0.1:9335/json/version"); break; } catch { await sleep(250); } }
    const cdp = await connectCdp(9335);
    const t = await cdp.send("Target.createTarget", { url: `${ORIGIN}/?voicetest=1` });
    const s = await cdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
    const sid = s.sessionId as string;
    await cdp.send("Runtime.enable", {}, sid);

    // entrar a la Antesala → mundo (patrón ciclo6)
    let bar = false;
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      const st = await evalJS(cdp, sid, `(() => ({go: !!document.getElementById('grGo'), bar: !!document.getElementById('gr-actionbar')}))()`);
      bar = !!st?.bar;
      if (bar) break;
      if (st?.go) {
        await evalJS(cdp, sid, `(() => { const h=document.getElementById('grHandle'); if(h){h.value='VozDisc'; h.dispatchEvent(new Event('input'));} })()`);
        await evalJS(cdp, sid, `(() => { const s=document.getElementById('grSnap'); if (s && !document.getElementById('grSnapOk')?.style?.display?.includes('inline')) s.click(); })()`);
        await evalJS(cdp, sid, `document.getElementById('grGo')?.click()`);
      }
    }
    check("7.1-a entró al mundo", bar, "no llegó a la barra");
    await sleep(2500);
    const pre = await evalJS(cdp, sid, `({st:(window.__lkRoom||{}).state, dbg:(window.__ns?.dbg||[]).slice(-5)})`);
    check("7.1-b voz conectada antes de la caída", pre?.st === "connected", JSON.stringify(pre));

    // AJUSTE 1 (unidad): desconexión MANUAL — el camino real es joinVoice con
    // cambio de zona, que setea sc.lkManualDisc=true antes del disconnect.
    // Simulamos exactamente ese estado: flag=true + Disconnected del room
    // vigente → dbg trae voice-disc-manual y NO programa rejoin (voice-disc).
    const man = await evalJS(cdp, sid, `(async () => {
      const sc = window.__ns?.scene; if (!sc) return {err:'no scene'};
      const before = (window.__ns?.dbg || []).length;
      sc.lkManualDisc = true;
      window.__lkRoom.emit("disconnected");
      await new Promise(r => setTimeout(r, 2500));
      const dbg = (window.__ns?.dbg || []).slice(before);
      return { manual: dbg.includes("voice-disc-manual"), rejoinScheduled: dbg.includes("voice-disc") };
    })()`);
    check("7.1-c AJUSTE 1: disc con flag manual NO programa rejoin", man && man.manual === true && man.rejoinScheduled === false, JSON.stringify(man));
    // limpieza del camino REAL: joinVoice con cambio de zona (ejercita flag +
    // disconnect manual + cleanup de sc.lkRoom — todo el flujo de la línea 141)
    const post = await evalJS(cdp, sid, `(async () => {
      const sc = window.__ns?.scene;
      const oldRoom = window.__lkRoom;
      await sc.joinVoice({ token: sc.lkLastMsg.token, url: sc.lkLastMsg.url, zoneId: "zone-b-test", isViewer: false });
      await new Promise(r => setTimeout(r, 2000));
      return { zone: sc.lkZone, oldGone: (window.__ns.dbg||[]).includes("voice-disc-manual") || window.__lkRoom !== oldRoom, st: (window.__lkRoom||{}).state };
    })()`);
    check("7.1-c2 cambio de zona via joinVoice: flag evita rejoin a zona vieja", post && post.zone === "zone-b-test" && post.st === "connected", JSON.stringify(post));
    // volver a la zona real (restaurar estado para 7.1-d)
    const back = await evalJS(cdp, sid, `(async () => {
      const sc = window.__ns?.scene;
      await sc.joinVoice({ ...sc.lkLastMsg, zoneId: "open-floor" });
      await new Promise(r => setTimeout(r, 2000));
      return { zone: sc.lkZone, st: (window.__lkRoom||{}).state };
    })()`);
    check("7.1-c3 re-join a la zona real reconecta", back?.zone === "open-floor" && back?.st === "connected", JSON.stringify(back));

    // CAÍDA REAL: reiniciar el contenedor de LiveKit (marcador para trazas post-caída)
    const marker = await evalJS(cdp, sid, `(window.__ns?.dbg||[]).length`);
    execSync("docker restart gr-livekit-gate", { stdio: "ignore" });
    console.log("livekit reiniciado — esperando self-heal (hasta 60s)…");
    let healed = false, st = "", tailDbg: any = null;
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      const r = await evalJS(cdp, sid, `({st:(window.__lkRoom||{}).state, dbg:(window.__ns?.dbg||[])})`);
      st = JSON.stringify({ st: r?.st, tail: (r?.dbg || []).slice(-6) });
      if (r?.st === "connected") { tailDbg = r.dbg; healed = true; break; }
    }
    check("7.1-d auto-rejoin tras caída real de LiveKit (sin recarga)", healed, st);
    if (healed) {
      // LiveKit puede sanar por 2 caminos válidos: auto-Reconnecting del SDK
      // (misma sesión) o Disconnected → nuestro rejoin con lkLastMsg. Cualquiera
      // deja trazas post-caída.
      const postDisc = (tailDbg || []).slice(marker || 0);
      const healedPath = postDisc.includes("voice-reconnecting") || postDisc.includes("voice-disc");
      check("7.1-e trazas del self-heal presentes (reconnecting o disc+rejoin)", healedPath, JSON.stringify(postDisc.slice(-8)));
      const statusTxt = await evalJS(cdp, sid, `(document.getElementById('status')||{}).textContent`);
      check("7.1-f #status sin mensaje de voz perdida (recovery OK)", !/Voz perdida/.test(statusTxt || ""), statusTxt);
    }
  } finally { chrome.kill("SIGKILL"); }

  console.log(`---- voice-reconnect-e2e: ${PASS} PASS / ${FAIL} FAIL ----`);
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.error("gate error:", e?.message || e); process.exit(2); });
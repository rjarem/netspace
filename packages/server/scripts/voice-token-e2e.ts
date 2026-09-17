// Gate CICLO 7.2 (auditor-firmado): refresco de token de voz.
// (1) Con VOICE_REFRESH_MS acortado, el cliente conectado recibe un "livekit"
//     NUEVO (token distinto) SIN cortar la sesión viva: room sigue "connected",
//     cero voice-disc, lkLastMsg actualizado (hook del 7.1).
// (2) Interval de voz limpiado en onDispose: grep del dist + smoke de dispose
//     (probe join/leave → server sano, health OK).
import { spawn, ChildProcess, execSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
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
  const profile = `/tmp/gr-72-chrome-${Date.now()}`;
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
  // (2a) assert estático: el dist del server limpia voiceRefresh en onDispose
  const distSrc = readFileSync("packages/server/dist/worldRoom.js", "utf8");
  check("7.2-a dist limpia voiceRefresh en onDispose", /clearInterval\(this\.voiceRefresh\)/.test(distSrc) && /lastVoiceZone\.clear\(\)/.test(distSrc));
  check("7.2-b dist tiene startVoiceRefresh con default 4h", /startVoiceRefresh/.test(distSrc) && /4 \* 60 \* 60 \* 1000/.test(distSrc));

  const chrome = launchChrome(9337);
  try {
    for (let i = 0; i < 40; i++) { try { await fetch("http://127.0.0.1:9337/json/version"); break; } catch { await sleep(250); } }
    const cdp = await connectCdp(9337);
    const t = await cdp.send("Target.createTarget", { url: `${ORIGIN}/?voicetest=1` });
    const s = await cdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
    const sid = s.sessionId as string;
    await cdp.send("Runtime.enable", {}, sid);

    let bar = false;
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      const st = await evalJS(cdp, sid, `(() => ({bar: !!document.getElementById('gr-actionbar')}))()`);
      bar = !!st?.bar;
      if (bar) break;
      if (await evalJS(cdp, sid, `!!document.getElementById('grGo')`)) {
        await evalJS(cdp, sid, `(() => { const h=document.getElementById('grHandle'); if(h){h.value='VozTok'; h.dispatchEvent(new Event('input'));} })()`);
        await evalJS(cdp, sid, `(() => { const s=document.getElementById('grSnap'); if (s) s.click(); })()`);
        await evalJS(cdp, sid, `document.getElementById('grGo')?.click()`);
      }
    }
    check("7.2-c entró al mundo", bar);
    await sleep(2500);
    const pre = await evalJS(cdp, sid, `({st:(window.__lkRoom||{}).state, tok: window.__ns?.scene?.lkLastMsg?.token?.slice(-12)})`);
    check("7.2-d voz conectada antes del refresh", pre?.st === "connected", JSON.stringify(pre));

    // VOICE_REFRESH_MS=3000 en el server del gate → esperar >=1 re-minteo
    console.log("esperando re-minteo (VOICE_REFRESH_MS=3000)…");
    let refreshed = false, tail: any = null;
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      const r = await evalJS(cdp, sid, `({st:(window.__lkRoom||{}).state, tok: window.__ns?.scene?.lkLastMsg?.token?.slice(-12), dbg:(window.__ns?.dbg||[])})`);
      tail = r;
      if (r?.tok && r.tok !== pre.tok) { refreshed = true; break; }
    }
    check("7.2-e token NUEVO recibido sin tocar la sesión", refreshed, JSON.stringify({ st: tail?.st, tok: tail?.tok }));
    const alive = await evalJS(cdp, sid, `({st:(window.__lkRoom||{}).state, disc:(window.__ns?.dbg||[]).includes('voice-disc'), dead:(window.__ns?.dbg||[]).includes('voice-dead')})`);
    check("7.2-f sesión viva SIN saltos (connected, cero voice-disc/dead)", alive?.st === "connected" && !alive.disc && !alive.dead, JSON.stringify(alive));
  } finally { chrome.kill("SIGKILL"); }

  // (2b) smoke de dispose: el room se desecha cuando el último cliente se va —
  // el server queda sano (health) tras el dispose con el interval limpiado.
  const health = await (await fetch(`${BASE}/api/health`)).json();
  check("7.2-g server sano tras ciclo join/leave (onDispose limpio)", health?.ok === true, JSON.stringify(health));

  console.log(`---- voice-token-e2e: ${PASS} PASS / ${FAIL} FAIL ----`);
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.error("gate error:", e?.message || e); process.exit(2); });
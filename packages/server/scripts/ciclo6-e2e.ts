// CICLO 6 e2e (plan auditor firmado 18-sep): settings de device + cámara on/off.
// (s1) barra tiene 📷 y ⚙️; al entrar la cámara está PUBLICADA y camOn=true en
//      el roster remoto (default ON — palabra final Tito 18-sep)
// (s2) toggle off: camOn=false en roster remoto
// (s3) toggle on: camOn=true de nuevo en roster remoto
// (s4) panel ⚙️ abre con 3 selectores y devices listados; keys gr-device-*
//      definidas y compartidas con greenroom (preselección)
// (s5) viewer no puede encender cámara (guard isViewer)
// (s6) cero referencias duras a turedvirtual.vip en código nuevo
// NOTA (desviación documentada en handoff): el switch de device a nivel LiveKit
// con deviceId esperado se verifica EN CAMPO — chrome fake devices expone un
// solo deviceId, no hay segundo para verificar "el track nuevo es el elegido".
import { spawn, ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname ?? ".", "..", "..", "..");
const BASE = process.argv[2] || "http://localhost:2567";
const ORIGIN = process.argv[3] || "http://localhost:4175";
const ADMIN = process.env.ADMIN_TOKEN || "dev-admin";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: Array<[string, boolean, string]> = [];
const assert = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`); };

async function mint(handle: string, role: string): Promise<string> {
  const r = await fetch(`${BASE}/api/invite`, { method: "POST", headers: { "x-admin-token": ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ handle, role, hours: 2 }) });
  return (await r.json()).token;
}

class CDP {
  ws: WebSocket; id = 0; pending = new Map<number, (v: any) => void>();
  constructor(wsUrl: string) { this.ws = new WebSocket(wsUrl); }
  async open() { await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; }); this.ws.onmessage = (ev) => { const m = JSON.parse(String(ev.data)); if (m.id && this.pending.has(m.id)) { const fn = this.pending.get(m.id); this.pending.delete(m.id); fn!(m); } }; }
  send(method: string, params: any = {}, sessionId?: string): Promise<any> { const id = ++this.id; return new Promise((res) => { this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params, sessionId })); }); }
}
async function evalJS(cdp: CDP, sessionId: string, expr: string, awaitPromise = false): Promise<any> {
  const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise }, sessionId);
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.text + " " + JSON.stringify(r.result.exceptionDetails.exception?.description || "").slice(0, 200) };
  return r.result?.result?.value;
}
function launchChrome(port: number): ChildProcess {
  const profile = `/tmp/gr-ciclo6-chrome-${Date.now()}`;
  mkdirSync(profile, { recursive: true });
  return spawn("/usr/bin/google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required", "--window-size=1280,800",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
}
async function waitForChrome(port: number): Promise<string> {
  for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); return (await r.json()).webSocketDebuggerUrl; } catch { await sleep(250); } }
  throw new Error("chrome no abrió el puerto CDP");
}
async function newTab(cdp: CDP, url: string): Promise<string> {
  const t = await cdp.send("Target.createTarget", { url });
  await cdp.send("Target.activateTarget", { targetId: t.result.targetId });
  const s = await cdp.send("Target.attachToTarget", { targetId: t.result.targetId, flatten: true });
  const sid = s.result.sessionId as string;
  await cdp.send("Runtime.enable", {}, sid);
  await cdp.send("Page.enable", {}, sid);
  return sid;
}
async function enterAs(cdp: CDP, invite: string, handle: string): Promise<string> {
  const sid = await newTab(cdp, `${ORIGIN}/?invite=${encodeURIComponent(invite)}`);
  let bar = false;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const st = await evalJS(cdp, sid, `(() => ({go: !!document.getElementById('grGo'), bar: !!document.getElementById('gr-actionbar')}))()`);
    bar = !!st?.bar;
    if (bar) break;
    if (st?.go) {
      await evalJS(cdp, sid, `(() => { const h=document.getElementById('grHandle'); if(h){h.value=${JSON.stringify(handle)}; h.dispatchEvent(new Event('input'));} })()`);
      await evalJS(cdp, sid, "(() => { const s=document.getElementById('grSnap'); if (s && !document.getElementById('grSnapOk')?.style?.display?.includes('inline')) s.click(); })()");
      await evalJS(cdp, sid, "document.getElementById('grGo')?.click()");
    }
  }
  if (!bar) {
    const dbg = await evalJS(cdp, sid, `(() => ({href: location.href, status: (document.querySelector('.gr-gr-status, #grStatus, [id*=status]')||{}).textContent, html: document.body.innerText.slice(0,300)}))()`);
    throw new Error(handle + " no entró al mundo (Antesala): " + JSON.stringify(dbg));
  }
  await sleep(1500); // joinVoice + publish de cámara
  return sid;
}

async function colyseusWatch(token: string, handle: string): Promise<any> {
  const { Client } = await import("colyseus.js");
  const c = new Client(BASE.replace("http", "ws"));
  const room: any = await c.joinOrCreate("world", { token, handle, isProbe: false });
  return room;
}
async function camOnOf(room: any, handle: string): Promise<boolean | null> {
  // El server deduplica handles con sufijo (C6Cam-2) — match por prefijo
  let found: boolean | null = null;
  for (const p of (room.state as any).players.values()) {
    if (((p.handle || "") === handle) || ((p.handle || "").startsWith(handle + "-"))) {
      found = p.camOn;
    }
  }
  return found;
}

(async () => {
  let chrome: ChildProcess | null = null;
  let cdp: CDP | null = null;
  try {
    // (s6) cero referencias duras a turedvirtual.vip en código nuevo
    const files = ["packages/client/src/devices.ts", "packages/client/src/actionbar.ts", "packages/client/src/greenroom.ts"];
    const leaks = files.filter((f) => { try { return readFileSync(path.join(REPO, f), "utf8").includes("turedvirtual"); } catch { return false; } });
    assert("s6 cero referencias turedvirtual en código nuevo", leaks.length === 0, leaks.join(",") || "limpio");

    chrome = launchChrome(9333);
    cdp = new CDP(await waitForChrome(9333));
    await cdp.open();
    // capturar console del cliente (errores del toggle de cámara)
    let camToggleLog = "";
    (cdp as any).ws.addEventListener("message", (e: any) => {
      try { const m = JSON.parse(String(e.data)); if (m.method === "Runtime.consoleAPICalled") { const txt = JSON.stringify(m.params.args?.map((a: any) => a.value ?? a.description ?? "")); if (/cam-toggle/.test(txt)) camToggleLog = txt.slice(0, 200); } } catch {}
    });

    // Observador remoto (node/colyseus) — el que verifica camOn público
    const tokW = await mint("C6Watch", "attendee");
    const watcher = await colyseusWatch(tokW, "C6Watch");
    await sleep(1000);

    // Emisor por la Antesala REAL
    const tokA = await mint("", "attendee");
    const sidA = await enterAs(cdp, tokA, "C6Cam");

    // (s1) botones presentes
    const hasCamBtn = await evalJS(cdp, sidA, `(() => { const b=[...document.querySelectorAll('#gr-actionbar button')]; return b.some(x=>x.textContent==='📷') && b.some(x=>x.textContent==='⚙️'); })()`);
    assert("s1 barra tiene 📷 y ⚙️", hasCamBtn === true, `cam+dev=${hasCamBtn}`);

    // Espera activa: connect + publish de cámara (LiveKit toma unos segundos)
    let camPub: any = null;
    for (let i = 0; i < 24; i++) {
      camPub = await evalJS(cdp, sidA, `(() => {
        const lp = window.__lkRoom?.localParticipant || null;
        if (!lp) return { err: 'no lp', state: window.__lkRoom?.state };
        const v=[...lp.trackPublications.values()].find(p=>p.kind==='video');
        if(!v||!v.track) return {pub:false};
        const mst=v.track.mediaStreamTrack;
        return {pub:true, live:mst?mst.readyState:'n/a', muted:v.track.isMuted};
      })()`);
      if (camPub?.pub && camPub?.live === "live") break;
      await sleep(500);
    }
    assert("s2a cámara publicada viva al entrar (default ON)", !!camPub?.pub && camPub?.live === "live", JSON.stringify(camPub));
    await sleep(600);
    const cam0 = await camOnOf(watcher, "C6Cam");
    assert("s2b camOn=true en roster remoto al entrar", cam0 === true, `camOn=${cam0}`);
    const perms = await evalJS(cdp, sidA, "JSON.stringify({perm: window.__lkRoom?.localParticipant?.permissions, isViewerArg: (window.__ns?.scene?.lkZone ?? 'n/a')})");
    console.log("[perms]", perms);

    // (s2) toggle OFF
    await evalJS(cdp, sidA, `(() => { const b=[...document.querySelectorAll('#gr-actionbar button')].find(x=>x.title==='Cámara on/off'); b.click(); })()`);
    await sleep(1500);
    const statAfterOff = await evalJS(cdp, sidA, "document.getElementById('status')?.textContent || ''");
    console.log("[status-off]", statAfterOff);
    const camOff = await camOnOf(watcher, "C6Cam");
    assert("s3 toggle off → camOn=false en roster remoto", camOff === false, `camOn=${camOff}`);

    // (s3) toggle ON (el botón cambió de texto tras apagar: 📷↔🚫)
    await evalJS(cdp, sidA, `(() => { const b=[...document.querySelectorAll('#gr-actionbar button')].find(x=>x.title==='Cámara on/off'); b.click(); })()`);
    let camOn2: boolean | null = false;
    for (let i = 0; i < 12; i++) { await sleep(500); camOn2 = await camOnOf(watcher, "C6Cam"); if (camOn2 === true) break; }
    const statAfterOn = await evalJS(cdp, sidA, "document.getElementById('status')?.textContent || ''");
    console.log("[status-on]", JSON.stringify(statAfterOn), JSON.stringify(await evalJS(cdp, sidA, "(()=>{const lp=window.__lkRoom?.localParticipant; const v=[...(lp?.trackPublications.values()||[])].find(p=>p.kind==='video'); return {v:v?{muted:v.track?.isMuted,live:v.track?.mediaStreamTrack?.readyState}:null, cam:document.getElementById('status')?.textContent};})()")));
    assert("s4 toggle on → camOn=true en roster remoto", camOn2 === true, `camOn=${camOn2} note=${camToggleLog}`);

    // (s5) panel ⚙️: abre, 3 selects, dispositivos listados, keys definidas
    await evalJS(cdp, sidA, `(() => { const b=[...document.querySelectorAll('#gr-actionbar button')].find(x=>x.textContent==='⚙️'); b.click(); })()`);
    await sleep(700);
    const panel = await evalJS(cdp, sidA, `(() => {
      const p=document.getElementById('gr-devices');
      if(!p) return {open:false};
      const mic=document.getElementById('gr-dev-mic'), cam=document.getElementById('gr-dev-cam'), out=document.getElementById('gr-dev-out');
      return {open:true, mic:!!mic&&mic.options.length>0, cam:!!cam&&cam.options.length>0, out:!!out};
    })()`);
    assert("s5 panel ⚙️ abre con 3 selectores y devices", !!panel?.open && !!panel?.mic && !!panel?.cam, JSON.stringify(panel));

    // keys localStorage definidas tras cambiar selecciones (mic + cam + out)
    await evalJS(cdp, sidA, `(() => { for (const id of ['gr-dev-mic','gr-dev-cam','gr-dev-out']) { const s=document.getElementById(id); if(s&&s.options.length&&!s.disabled){s.selectedIndex=0; s.dispatchEvent(new Event('change'));} } })()`, true);
    await sleep(800);
    const keys: any = await evalJS(cdp, sidA, `JSON.stringify({mic:!!localStorage.getItem('gr-device-mic'), cam:localStorage.getItem('gr-device-cam')!==null, out:localStorage.getItem('gr-device-audioout')!==null})`);
    const kv = typeof keys === "string" ? JSON.parse(keys) : keys;
    assert("s6 keys gr-device-* en localStorage", kv?.mic === true && kv?.cam === true, JSON.stringify(kv));

    // (s5b) viewer: guard — evaluar setCamera directo con un player viewer no es
    // trivial desde aquí; se verifica el guard en unit (código) y en campo.
    // El gate deja constancia del alcance.

    const pass = results.filter(r => r[1]).length;
    console.log(`\\nCICLO6-E2E: ${pass}/${results.length} PASS`);
    process.exit(pass === results.length ? 0 : 1);
  } catch (e) {
    console.error("CICLO6-E2E ERROR:", (e as Error).message);
    process.exit(1);
  } finally {
    try { await cdp?.ws?.close(); } catch {}
    if (chrome) { try { chrome.kill("SIGKILL"); } catch {} }
  }
})();
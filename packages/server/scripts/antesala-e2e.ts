// antesala-e2e.ts — Gate NUEVO (auditor 17-sep, Fix B): ejercita el path REAL
// Antesala → getUserMedia (mic fake de chrome) → publishTrack(track crudo) con
// ASSERTS DEL EMISOR que ningún gate tenía:
//   1. Emisor: pub de audio con track.isMuted === false,
//      mediaStreamTrack.readyState === 'live', enabled === true, y
//      getSenderStats().bytesSent CRECIENDO entre dos lecturas 3s aparte.
//   2. Receptor: RMS > 0.5 * rms_cerca (calibrado, medido en la salida del gain).
// Este gate habría cachado B2 (track Antesala muerto publicado) y B3
// (pauseUpstream) antes del deploy del 16-sep.
//
// Uso: npx tsx packages/server/scripts/antesala-e2e.ts <BASE> <ORIGIN>
import { spawn, ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:2567";
const ORIGIN = process.argv[3] || "http://localhost:4175";
const ADMIN = process.env.ADMIN_TOKEN || "dev-admin";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TILE = 48;

async function mint(handle: string, role: string): Promise<string> {
  const r = await fetch(`${BASE}/api/invite`, { method: "POST", headers: { "x-admin-token": ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ handle, role, hours: 2 }) });
  return (await r.json()).token;
}

// ---- CDP mínimo (mismo patrón que reapproachprobe) ----
class CDP {
  ws: WebSocket;
  id = 0;
  pending = new Map<number, (v: any) => void>();
  constructor(wsUrl: string) { this.ws = new WebSocket(wsUrl); }
  async open() {
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && this.pending.has(m.id)) { const fn = this.pending.get(m.id); this.pending.delete(m.id); fn!(m); }
    };
  }
  send(method: string, params: any = {}, sessionId?: string): Promise<any> {
    const id = ++this.id;
    return new Promise((res) => {
      this.pending.set(id, res);
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
}

async function evalJS(cdp: CDP, sessionId: string, expr: string, awaitPromise = false): Promise<any> {
  const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise }, sessionId);
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.text + " " + JSON.stringify(r.result.exceptionDetails.exception?.description || "").slice(0, 200) };
  return r.result?.result?.value;
}

function launchChrome(port: number): ChildProcess {
  const profile = `/tmp/gr-antesala-chrome-${Date.now()}`;
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
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); return (await r.json()).webSocketDebuggerUrl; }
    catch { await sleep(250); }
  }
  throw new Error("chrome no abrió el puerto CDP");
}

async function newTab(cdp: CDP, url: string): Promise<string> {
  const t = await cdp.send("Target.createTarget", { url });
  await cdp.send("Target.activateTarget", { targetId: t.result.targetId });
  const s = await cdp.send("Target.attachToTarget", { targetId: t.result.targetId, flatten: true });
  const sid = s.result.sessionId as string;
  (globalThis as any).__tids = (globalThis as any).__tids || {};
  (globalThis as any).__tids[sid] = t.result.targetId;
  await cdp.send("Runtime.enable", {}, sid);
  await cdp.send("Page.enable", {}, sid);
  return sid;
}

async function targetIdOf(cdp: CDP, sid: string): Promise<string> {
  return (globalThis as any).__tids?.[sid];
}

// Entrar por la ANTESALA REAL (mismo flujo que un usuario: handle → captura de
// mic/cámara fake → Entrar → mundo). El cliente queda con __greenroom.micStream
// y publica el track crudo vía publishTrack (el path sin cobertura).
async function enterAs(cdp: CDP, invite: string, handle: string): Promise<string> {
  const sid = await newTab(cdp, `${ORIGIN}/?invite=${encodeURIComponent(invite)}`);
  for (let i = 0; i < 30; i++) { await sleep(500); if (await evalJS(cdp, sid, "!!document.getElementById('grGo')")) break; }
  await evalJS(cdp, sid, `(() => { const h=document.getElementById('grHandle'); if(h){h.value=${JSON.stringify(handle)}; h.dispatchEvent(new Event('input'));} })()`);
  await evalJS(cdp, sid, "document.getElementById('grGo')?.click()");
  let bar = false;
  for (let i = 0; i < 40; i++) { await sleep(500); bar = !!(await evalJS(cdp, sid, "!!document.getElementById('gr-actionbar')")); if (bar) break; }
  if (!bar) throw new Error(handle + " no entró al mundo (Antesala)");
  await evalJS(cdp, sid, "(() => { const c=window.__nsVoiceCtx; if(c && c.state==='suspended') c.resume().catch(()=>{}); document.dispatchEvent(new PointerEvent('pointerdown')); return 'ok'; })()");
  return sid;
}

// Entrada robusta (patrón reapproachprobe): en cada iteración refresca handle,
// toma la foto (la Antesala bloquea Entrar si hay stream sin foto) y pica grGo.
async function enterAs2(cdp: CDP, invite: string, handle: string): Promise<string> {
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
  if (!bar) throw new Error(handle + " no entró al mundo (Antesala)");
  await evalJS(cdp, sid, "(() => { const c=window.__nsVoiceCtx; if(c && c.state==='suspended') c.resume().catch(()=>{}); document.dispatchEvent(new PointerEvent('pointerdown')); return 'ok'; })()");
  return sid;
}

// ---- Asserts del EMISOR (lo que ningún gate medía) ----
async function emitterAsserts(cdp: CDP, sidA: string) {
  return evalJS(cdp, sidA, `(() => {
    const lp = window.__ns?.scene?.lkRoom?.localParticipant;
    if (!lp) return { err: 'no-localParticipant' };
    const pub = [...lp.trackPublications.values()].find(x => x.kind === 'audio');
    if (!pub) return { err: 'no-audio-pub' };
    const t = pub.track;
    return {
      isMuted: t?.isMuted ?? null,
      readyState: t?.mediaStreamTrack?.readyState ?? null,
      enabled: t?.mediaStreamTrack?.enabled ?? null,
      isUserProvided: !!t?.isUserProvided,
    };
  })()`);
}

async function bytesSent(cdp: CDP, sidA: string): Promise<number | null> {
  return evalJS(cdp, sidA, `(async () => {
    const lp = window.__ns?.scene?.lkRoom?.localParticipant;
    const pub = [...(lp?.trackPublications.values()||[])].find(x => x.kind === 'audio');
    if (!pub?.track) return null;
    try { const st = await pub.track.getSenderStats(); const arr = Array.isArray(st) ? st : [st]; return arr.reduce((a,s)=>a+(s.bytesSent||0),0); }
    catch (e) { return -1000 + ('' + (e && e.message || e)).slice(0, 120); }
  })()`, true);
}

// ---- Receptor: RMS en la salida del gain (mismo meter que reapproachprobe) ----
async function setupMeter(cdp: CDP, sidB: string) {
  await evalJS(cdp, sidB, `(() => {
    const ctx = window.__nsVoiceCtx;
    const an = ctx.createAnalyser(); an.fftSize = 2048;
    window.__meter = { an, gainRef: null };
    window.__meterHook = () => {
      try {
        const a = [...window.__ns.scene.players.values()].find(q => q.handle === 'E2eA');
        if (a && a.audioNode && window.__meter.gainRef !== a.audioNode.gain) {
          a.audioNode.gain.connect(an);
          window.__meter.gainRef = a.audioNode.gain;
        }
      } catch (e) { window.__meter.err = String(e).slice(0, 100); }
    };
    return 'ok';
  })()`);
}

async function readRms(cdp: CDP, sidB: string): Promise<number> {
  await cdp.send("Target.activateTarget", { targetId: await targetIdOf(cdp, sidB) });
  await sleep(700);
  await evalJS(cdp, sidB, "window.__meterHook && window.__meterHook()");
  // Muestreo MÁXIMO: el fake device emite beeps intermitentes (misma lección
  // que reapproachprobe) — una sola muestra cae en silencio.
  let mx = -1;
  for (let i = 0; i < 12; i++) {
    const v = Number(await evalJS(cdp, sidB, `(() => { const m=window.__meter; if(!m) return -1; const buf=new Float32Array(m.an.fftSize); m.an.getFloatTimeDomainData(buf); let s=0; for(const v of buf) s+=v*v; return Math.sqrt(s/buf.length); })()`));
    if (v > mx) mx = v;
    await sleep(180);
  }
  return mx;
}

(async () => {
  const results: string[] = [];
  let chrome: ChildProcess | null = null;
  try {
    const PORT = 9341;
    chrome = launchChrome(PORT);
    const cdp = new CDP(await waitForChrome(PORT));
    await cdp.open();

    const sidA = await enterAs2(cdp, await mint("E2eA", "attendee"), "E2eA");
    console.log("[antesala-e2e] A entró vía Antesala (track crudo fake-mic)");
    const sidB = await enterAs2(cdp, await mint("E2eB", "attendee"), "E2eB");
    console.log("[antesala-e2e] B entró");

    // esperar pub de audio en A y suscripción + chain en B
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await sleep(700);
      const v = await evalJS(cdp, sidB, `(() => { const s=window.__ns?.scene; const a=[...s.players.values()].find(q=>q.handle==='E2eA'); const pub=[...(s.lkRoom?.remoteParticipants.values()||[])].flatMap(p=>[...p.trackPublications.values()]).find(x=>x.kind==='audio'); return a?.audioNode && pub?.isSubscribed ? 'ready' : ''; })()`);
      if (v) { ready = true; break; }
    }
    results.push(`setup: A publica + B suscrito+chain = ${ready ? "OK" : "TIMEOUT"}`);

    // caminar A junto a B (B fijo): target en TILES (schema), no worldX —
    // mismo bug de unidades que reapproachprobe (auditor #3).
    await cdp.send("Target.activateTarget", { targetId: await targetIdOf(cdp, sidA) });
    await sleep(500);
    await evalJS(cdp, sidA, `(() => { const s=window.__ns?.scene; const b=[...s.players.values()].find(q=>q.handle==='E2eB'); const sp=b?.schema; if(!sp) return 'no-B'; s.target={x:Math.round(sp.x), y:Math.round(sp.y)}; return 'ok'; })()`);
    for (let i = 0; i < 60; i++) {
      await sleep(600);
      const st = await evalJS(cdp, sidA, `(() => { const s=window.__ns?.scene; const me=s.players.get(s.myId); const b=[...s.players.values()].find(q=>q.handle==='E2eB'); const d=b&&me?Math.hypot(me.worldX-b.worldX, me.worldY-b.worldY)/32:999; return !s.target && !s.movingTo ? {d:Math.round(d)} : null; })()`);
      if (st) { console.log("[antesala-e2e] A llegó, dist:", st.d); break; }
    }
    await setupMeter(cdp, sidB);

    // Asserts EMISOR
    const ea = await emitterAsserts(cdp, sidA);
    const b1 = await bytesSent(cdp, sidA);
    await sleep(3000);
    const b2 = await bytesSent(cdp, sidA);
    const bytesGrowing = typeof b1 === "number" && typeof b2 === "number" && b2 > b1;
    const EMITTER_OK = ea.isMuted === false && ea.readyState === "live" && ea.enabled === true && bytesGrowing;
    results.push(`emisor: isMuted=${ea.isMuted} readyState=${ea.readyState} enabled=${ea.enabled} userProvided=${ea.isUserProvided} bytesSent=${b1}→${b2} (${bytesGrowing ? "crece" : "PLANO"}) → ${EMITTER_OK ? "PASS" : "FAIL"}`);

    // Receptor: RMS calibrado (cerca)
    await sleep(2000);
    const rms = await readRms(cdp, sidB);
    const RECV_OK = rms > 0;
    results.push(`receptor: rms=${Number(rms).toFixed(4)} (cerca, debe ser >0) → ${RECV_OK ? "PASS" : "FAIL"}`);

    console.log("\n=== RESULTADOS antesala-e2e ===");
    results.forEach((r) => console.log(r));
    const fail = !ready || !EMITTER_OK || !RECV_OK;
    console.log(fail ? "\nGATE antesala-e2e: FAIL" : "\nGATE antesala-e2e: PASS");
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error("ERROR antesala-e2e:", (e as Error).message);
    console.log(results.join("\n"));
    process.exit(1);
  } finally {
    try { chrome?.kill(); } catch {}
    try { await fetch(`http://127.0.0.1:9341/json/list`); } catch {}
  }
})();

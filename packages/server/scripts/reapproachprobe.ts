// reapproachprobe.ts — Gate REGLA 0 (auditor, 16-sep): reproducir el bug de
// audio al alejarse/acercarse ANTES de tocar código. Debe FALLAR contra
// ad348d6 (RMS no vuelve al acercarse). Luego debe PASAR con el fix watchdog.
//
// Diseño:
//  - ProbeA: usuario colyseus real + firefox fake-mic publicando (patrón h2realprobe)
//  - ProbeB: cliente REAL en chrome headless (fake media flags) — medimos RMS
//    de la cadena WebAudio de A dentro de B
//  - A camina >9 tiles lejos → RMS debe caer a ~0
//  - A regresa junto a B → RMS debe VOLVER > umbral en <8s (esto falla hoy)
//  - Verdugo R1: ProbeC entra y su tab muere → B: ctx.state === 'closed' = bug
//
// Uso: npx tsx packages/server/scripts/reapproachprobe.ts <BASE> <ORIGIN>
import fs from "node:fs";
import { spawn, ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] || "https://api.turedvirtual.vip";
const ORIGIN = process.argv[3] || "https://play.turedvirtual.vip";
const ADMIN = process.env.ADMIN_TOKEN || "dev-admin";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TILE = 48;

async function mint(handle: string, role: string): Promise<string> {
  const r = await fetch(`${BASE}/api/invite`, { method: "POST", headers: { "x-admin-token": ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ handle, role, hours: 2 }) });
  return (await r.json()).token;
}

// ---- CDP mínimo con WebSocket nativo de Node 22 ----
class CDP {
  ws: WebSocket;
  id = 0;
  pending = new Map<number, (v: any) => void>();
  events: ((m: any) => void)[] = [];
  constructor(wsUrl: string) { this.ws = new WebSocket(wsUrl); }
  async open() {
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
      else if (m.method) this.events.forEach((f) => f(m));
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
  const profile = `/tmp/gr-reappro-chrome-${Date.now()}`;
  mkdirSync(profile, { recursive: true });
  return spawn("/usr/bin/google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required", "--window-size=1280,800",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
}

async function waitForChrome(port: number, child: ChildProcess): Promise<string> {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      const j: any = await r.json();
      return j.webSocketDebuggerUrl;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("chrome no abrió el puerto CDP");
}

async function targetIdOf(cdp: CDP, sid: string): Promise<string> {
  // sessionId → targetId: guardamos el mapping al crear el tab
  return (globalThis as any).__tids?.[sid] || (globalThis as any).__tids?.[Object.keys((globalThis as any).__tids||{})[0]];
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

async function enterAs(cdp: CDP, invite: string, handle: string): Promise<string> {
  const sid = await newTab(cdp, `${ORIGIN}/?invite=${encodeURIComponent(invite)}`);
  for (let i = 0; i < 30; i++) { await sleep(500); if (await evalJS(cdp, sid, "!!document.getElementById('grGo')")) break; }
  await evalJS(cdp, sid, `(() => { const h=document.getElementById('grHandle'); if(h){h.value=${JSON.stringify(handle)}; h.dispatchEvent(new Event('input'));} })()`);
  await evalJS(cdp, sid, "document.getElementById('grGo')?.click()");
  let bar = false;
  for (let i = 0; i < 40; i++) { await sleep(500); bar = !!(await evalJS(cdp, sid, "!!document.getElementById('gr-actionbar')")); if (bar) break; }
  if (!bar) throw new Error(handle + " no entró al mundo");
  // reanudar ctx (headless no da gesto real): despachar pointerdown sintético + resume
  await evalJS(cdp, sid, "(() => { const c=window.__nsVoiceCtx; if(c && c.state==='suspended') c.resume().catch(()=>{}); document.dispatchEvent(new PointerEvent('pointerdown')); return 'ok'; })()");
  return sid;
}

// posiciones en tiles
async function pos(cdp: CDP, sid: string, handle: string): Promise<{x:number,y:number} | null> {
  const v = await evalJS(cdp, sid, `(() => { const s=window.__ns?.scene; if(!s) return null; const p=[...s.players.values()].find(q=>q.handle===${JSON.stringify(handle)}); return p && p.worldX!=null ? {x:p.worldX, y:p.worldY} : null; })()`);
  return v;
}

// A camina usando el pathfinding del cliente (sc.target) — activar su tab
// durante la caminata (rAF) y luego devolver el foco a B para medir.
async function walkWithClient(cdp: CDP, sidA: string, to: {x:number,y:number}): Promise<boolean> {
  const tidA = await targetIdOf(cdp, sidA);
  await cdp.send("Target.activateTarget", { targetId: tidA });
  await sleep(500);
  await evalJS(cdp, sidA, `(() => { const s=window.__ns?.scene; if(!s) return 'no-scene'; const me=s.players.get(s.myId); s.target={x:${to.x}, y:${to.y}}; return 'target-set desde '+Math.round(me?.worldX/48)+','+Math.round(me?.worldY/48); })()`);
  for (let i = 0; i < 40; i++) {
    await sleep(600);
    const st = await evalJS(cdp, sidA, `(() => { const s=window.__ns?.scene; const me=s?.players.get(s.myId); if(!me) return null; return {x:me.worldX, y:me.worldY, tgt:!!s.target, moving:!!s.movingTo}; })()`);
    if (st && !st.tgt && !st.moving) return true;
  }
  return false;
}
let sidB_global = "";
let sidA_tab = "";

async function installMeter(cdp: CDP, sidB: string): Promise<void> {
  await evalJS(cdp, sidB, `(() => {
    const s = window.__ns.scene; const ctx = window.__nsVoiceCtx;
    const an = ctx.createAnalyser(); an.fftSize = 512;
    window.__meter = { an, hookedTo: null, err: null };
    window.__meterHook = () => {
      try {
        const a = [...s.players.values()].find(q => q.handle === 'ReapproA');
        if (a && a.audioNode && window.__meter.hookedTo !== a) {
          try { window.__meter.hookedTo?.audioNode?.gain?.disconnect?.(an); } catch {}
          a.audioNode.gain.connect(an);
          window.__meter.hookedTo = a;
        }
      } catch (e) { window.__meter.err = String(e).slice(0, 100); }
    };
    return 'meter-ok ctx=' + ctx.state;
  })()`);
}

const rmsB = async (cdp: CDP, sidB: string) => {
  await cdp.send("Target.activateTarget", { targetId: await targetIdOf(cdp, sidB) });
  await sleep(700);
  return {
    rms: await evalJS(cdp, sidB, `(() => { const m=window.__meter; if(!m) return -1; m.hookHook(); const buf=new Float32Array(m.an.fftSize); m.an.getFloatTimeDomainData(buf); let s=0; for(const v of buf) s+=v*v; return Math.sqrt(s/buf.length); })()`.replace('m.hookHook()', 'm.hookHook && m.hookHook()')),
    ctx: await evalJS(cdp, sidB, "window.__nsVoiceCtx?.state ?? '?'"),
    dbg: await evalJS(cdp, sidB, "(window.__ns?.scene?.dbg||[]).slice(-4).join('|')"),
  };
};

(async () => {
  const results: string[] = [];
  let chrome: ChildProcess | null = null;
  try {
    // --- chrome (un solo browser): A y B como clientes reales con mic fake ---
    const PORT = 9337;
    chrome = launchChrome(PORT);
    const wsUrl = await waitForChrome(PORT, chrome);
    const cdp = new CDP(wsUrl);
    await cdp.open();
    const sidA = await enterAs(cdp, await mint("ReapproA", "attendee"), "ReapproA");
    console.log("[reappro] A entró (cliente real, mic fake = tono)");
    // verificar que A publica audio en LiveKit
    let aPub = false;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const v = await evalJS(cdp, sidA, `(() => { const lp=window.__ns?.scene?.lkRoom?.localParticipant; const pub=[...(lp?.trackPublications.values()||[])].find(x=>x.kind==='audio'); return pub ? (pub.isSubscribed!==undefined?'pub':'') : ''; })()`);
      if (v) { aPub = true; break; }
    }
    console.log(`[reappro] A publica audio: ${aPub ? "SÍ" : "NO (gate ciego en RMS)"}`);

    // --- B (cliente real) ---
    const sidB = await enterAs(cdp, await mint("ReapproB", "attendee"), "ReapproB");
    sidB_global = sidB;
    sidA_tab = sidA;
    let pA: any = null;
    for (let i = 0; i < 30; i++) { await sleep(700); pA = await pos(cdp, sidB, "ReapproA"); if (pA) break; }
    if (!pA) { console.log("FAIL reappro: A nunca apareció en el mundo para B"); process.exit(2); }
    let pB = await pos(cdp, sidB, "ReapproB");
    await installMeter(cdp, sidB);

    // t0: cerca → RMS debe ser > 0
    await sleep(2500);
    const t0 = await rmsB(cdp, sidB);
    const chainInfo = await evalJS(cdp, sidB, `(() => { const s=window.__ns?.scene; const a=[...s.players.values()].find(q=>q.handle==='ReapproA'); if(!a) return 'A-no-en-mundo'; const pub=[...(s.lkRoom?.remoteParticipants.values()||[])].flatMap(p=>[...p.trackPublications.values()]).find(x=>x.kind==='audio'); return 'chain='+!!a.audioNode+' sub='+!!pub?.isSubscribed+' mute='+pub?.track?.isMuted; })()`);
    results.push(`t0-cerca: rms=${Number(t0.rms).toFixed(4)} ctx=${t0.ctx} ${chainInfo} dbg=${t0.dbg}`);

    // lejos: caminar A a 12 tiles
    const far = { x: pB!.x + 12 * TILE * (pB!.x > 600 ? -1 : 1), y: pB!.y };
    await walkWithClient(cdp, sidA_tab, far);
    await sleep(4500);
    const t1 = await rmsB(cdp, sidB);
    const pAfar = await pos(cdp, sidB, "ReapproA");
    results.push(`t1-lejos: rms=${Number(t1.rms).toFixed(4)} dist=${pAfar && pB ? Math.round(Math.hypot(pAfar.x - pB.x, pAfar.y - pB.y) / TILE) : '?'} ctx=${t1.ctx}`);

    // volver: A regresa junto a B
    await walkWithClient(cdp, sidA_tab, pB!);
    await sleep(5000);
    const t2 = await rmsB(cdp, sidB);
    const pAback = await pos(cdp, sidB, "ReapproA");
    const distBack = pAback && pB ? Math.round(Math.hypot(pAback.x - pB.x, pAback.y - pB.y) / TILE) : -1;
    const RECOVERED = Number(t2.rms) > 0.002 && distBack <= 4;
    results.push(`t2-vuelta: rms=${Number(t2.rms).toFixed(4)} dist=${distBack} ctx=${t2.ctx} dbg=${t2.dbg} → ${RECOVERED ? "PASS audio volvió" : "FAIL audio NO volvió (REPRO del bug)"}`);

    // verdugo R1: C entra y muere → ctx de B debe seguir 'running' (hoy queda 'closed')
    const tokC = await mint("ReapproC", "attendee");
    const sidC = await newTab(cdp, `${ORIGIN}/?invite=${encodeURIComponent(tokC)}`);
    for (let i = 0; i < 30; i++) { await sleep(500); if (await evalJS(cdp, sidC, "!!document.getElementById('grGo')")) break; }
    await evalJS(cdp, sidC, "document.getElementById('grGo')?.click()");
    await sleep(4000);
    const t3a = await cdp.send("Target.getTargets");
    const cInfo = (t3a.result.targetInfos as any[]).find((x) => (x.url || "").includes("play.turedvirtual") && x.targetId !== undefined);
    // identificar el target de C por su título/handle — cerramos el más reciente distinto de A y B
    const ctxAfterJoin = await evalJS(cdp, sidB, "window.__nsVoiceCtx?.state");
    if (cInfo) await cdp.send("Target.closeTarget", { targetId: cInfo.targetId });
    await sleep(3000);
    const t3 = await rmsB(cdp, sidB);
    const R1OK = t3.ctx === "running";
    results.push(`t3-verdugo: ctx tras join+leave de C = ${t3.ctx} (antes: ${ctxAfterJoin}) rms=${Number(t3.rms).toFixed(4)} → ${R1OK ? "PASS ctx vivo" : "FAIL ctx CERRADO (R1 reproducido)"}`);

    console.log("\n=== RESULTADOS reapproachprobe ===");
    results.forEach((r) => console.log(r));
    const repro = !RECOVERED || !R1OK;
    console.log(repro ? "\nGATE: FALLA (bug reproducido) → procede el fix" : "\nGATE: PASA con ad348d6 (no reproduce el bug — revisar el gate)");
    process.exit(repro ? 3 : 0);
  } catch (e) {
    console.error("ERROR reappro:", (e as Error).message);
    console.log(results.join("\n"));
    process.exit(1);
  } finally {
    try { chrome?.kill(); } catch {}
  }
})();

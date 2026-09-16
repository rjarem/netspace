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
  // Patrón robusto (alineado con debug-enter, que entró 2/2): en CADA iteración
  // refrescar el handle y picar grGo. Un solo click temprano se perdía ~50%.
  let bar = false;
  let lastBody = "";
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const st = await evalJS(cdp, sid, `(() => ({go: !!document.getElementById('grGo'), bar: !!document.getElementById('gr-actionbar'), body: document.body?.innerText?.slice(0,120)}))()`);
    if (st?.__err) lastBody = String(st.__err).slice(0, 120);
    else {
      lastBody = st.body || "";
      bar = !!st.bar;
      if (bar) break;
      if (st.go) {
        await evalJS(cdp, sid, `(() => { const h=document.getElementById('grHandle'); if(h){h.value=${JSON.stringify(handle)}; h.dispatchEvent(new Event('input'));} })()`);
        // Validación de la Antesala: si hay stream vivo y NO hay foto, grGo se
        // bloquea ("Falta tu foto de avatar") — era la causa de la flakiness
        // (carrera entre openStream y el primer click). Si hay stream, tomar
        // la foto ANTES de picar Entrar.
        await evalJS(cdp, sid, "(() => { const s=document.getElementById('grSnap'); if (s && !document.getElementById('grSnapOk')?.style?.display?.includes('inline')) s.click(); })()");
        await evalJS(cdp, sid, "document.getElementById('grGo')?.click()");
      }
    }
  }
  if (!bar) throw new Error(handle + " no entró al mundo; estado: " + lastBody);
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
  for (let i = 0; i < 80; i++) {
    await sleep(600);
    const st = await evalJS(cdp, sidA, `(() => { const s=window.__ns?.scene; const me=s?.players.get(s.myId); if(!me) return null; return {x:me.worldX, y:me.worldY, tgt:!!s.target, moving:!!s.movingTo}; })()`);
    if (st && !st.tgt && !st.moving) return true;
  }
  return false;
}
let sidB_global = "";
let sidA_tab = "";

async function installMeter(cdp: CDP, sidB: string): Promise<void> {
  // El ctx compartido se crea ON-DEMAND (llega con el primer audio remoto) —
  // esperar hasta que exista antes de crear el analyser sobre él.
  for (let i = 0; i < 30; i++) {
    const has = await evalJS(cdp, sidB, "!!window.__nsVoiceCtx");
    if (has) break;
    await sleep(700);
  }
  const install = await evalJS(cdp, sidB, `(() => {
    const ctx = window.__nsVoiceCtx;
    if (!ctx) return 'no-ctx';
    const an = ctx.createAnalyser(); an.fftSize = 2048;
    // Fix gate (auditor 17-sep §3): analyser teed a la SALIDA del gain del
    // jugador A. El watchdog reconstruye el chain (gain NUEVO tras
    // teardown+build) → el hook debe RE-conectar al gain VIGENTE en cada
    // lectura, rastreando el objeto gain (no el player). connect() al mismo
    // destino es idempotente.
    window.__meter = { an, gainRef: null, err: null };
    window.__meterHook = () => {
      try {
        const a = [...window.__ns.scene.players.values()].find(q => q.handle === 'ReapproA');
        if (a && a.audioNode && window.__meter.gainRef !== a.audioNode.gain) {
          try { window.__meter.gainRef?.disconnect?.(an); } catch {}
          a.audioNode.gain.connect(an);
          window.__meter.gainRef = a.audioNode.gain;
        }
      } catch (e) { window.__meter.err = String(e).slice(0, 100); }
    };
    return 'meter-ok ctx=' + ctx.state;
  })()`);
  console.log("[reappro] installMeter retorno:", JSON.stringify(install).slice(0, 200));
  const chk = await evalJS(cdp, sidB, "!!window.__meter");
  console.log("[reappro] installMeter __meter presente:", chk);
}

const rmsB = async (cdp: CDP, sidB: string) => {
  await cdp.send("Target.activateTarget", { targetId: await targetIdOf(cdp, sidB) });
  await sleep(700);
  // re-conectar al gain vigente ANTES de medir (el hook refresca gainRef)
  await evalJS(cdp, sidB, "window.__meterHook && window.__meterHook()");
  return {
    rms: await evalJS(cdp, sidB, `(() => { const m=window.__meter; if(!m) return -1; const buf=new Float32Array(m.an.fftSize); m.an.getFloatTimeDomainData(buf); let s=0; for(const v of buf) s+=v*v; return Math.sqrt(s/buf.length); })()`),
    err: await evalJS(cdp, sidB, "window.__meter?.err ?? null"),
    ctx: await evalJS(cdp, sidB, "window.__nsVoiceCtx?.state ?? '?'"),
    who: await evalJS(cdp, sidB, "window.__ns?.scene?.players?.get?.(window.__ns?.scene?.myId)?.handle || '??'"),
    dbg: await evalJS(cdp, sidB, "(window.__ns?.scene?.dbg||[]).slice(-4).join('|')"),
  };
};

// Guardas anti-regresión de la Falla A (auditor 17-sep §3): para CADA remoto,
// su keepAlive <audio> debe estar muted=true y volume=0 (el canal fantasma
// desmuteado por attachToElement NO debe volver); y el conteo de elementos
// <audio> debe ser exactamente 1 por remoto con audio (sin fallbacks filtrados).
const fallaAGuards = async (cdp: CDP, sidB: string) => {
  return await evalJS(cdp, sidB, `(() => {
    const s = window.__ns?.scene; if (!s) return { err: 'no-scene' };
    const remotes = [...(s.lkRoom?.remoteParticipants?.values() || [])];
    let audioRemotes = 0; const bad: string[] = [];
    for (const rp of remotes) {
      const pub = [...rp.trackPublications.values()].find(x => x.kind === 'audio');
      if (!pub || !pub.isSubscribed) continue;
      audioRemotes++;
      const p = s.players.get(rp.identity);
      const el = p?.audioEl;
      if (!el) { bad.push(rp.identity + ':sin-keepalive'); continue; }
      if (el.muted !== true || el.volume !== 0) bad.push(rp.identity + ':muted=' + el.muted + ',vol=' + el.volume);
    }
    const audioEls = document.querySelectorAll('audio').length;
    return { audioRemotes, audioEls, ok: bad.length === 0 && audioEls === audioRemotes, bad };
  })()`);
};

(async () => {
  const results: string[] = [];
  let chrome: ChildProcess | null = null;
  try {
    // --- chrome (un solo browser): A y B como clientes reales con mic fake ---
    // Puerto ÚNICO por run: un chrome huérfano de un run previo en el mismo
    // puerto hacía que waitForChrome conectara al chrome VIEJO (tabs muertas).
    let wsUrl = "";
    let chrome2: ChildProcess | null = null;
    for (let attempt = 0; attempt < 3 && !wsUrl; attempt++) {
      const PORT = 9400 + Math.floor(Math.random() * 90);
      chrome2 = launchChrome(PORT);
      try { wsUrl = await waitForChrome(PORT, chrome2); }
      catch { try { chrome2?.kill(); } catch {} chrome2 = null; }
    }
    if (!chrome2 || !wsUrl) throw new Error("chrome no abrió CDP en ningún puerto");
    chrome = chrome2;
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

    // FASE APROXIMAR: A y B pueden spawnear MUY lejos (spawn con wrap por
    // filas) — caminar A hacia B con re-targeting hasta dist<=3. Sin esto el
    // gate medía rms=0 "cerca" y era inútil.
    const walkNear = async (): Promise<number> => {
      for (let i = 0; i < 45; i++) {
        await cdp.send("Target.activateTarget", { targetId: await targetIdOf(cdp, sidA_tab) });
        // COORDENADAS DEL SERVER (schema.x/y), NO sprite.worldX: el sprite puede
        // estar WRAPPED por vista (render por filas) y A perseguía la copia
        // visual de B alejándose de la real (hallazgo 17-sep: d crecía 11→89).
        await evalJS(cdp, sidA_tab, `(() => { const s=window.__ns?.scene; const b=[...s.players.values()].find(q=>q.handle==='ReapproB'); const sp=b?.schema; if(!b||!sp) return 'no-B'; s.target={x:sp.x*48+24, y:sp.y*48+24}; return 'ok'; })()`);
        await sleep(3000);
        const pA = await pos(cdp, sidB, "ReapproA");
        const d = pA && pB ? Math.round(Math.hypot(pA.x - pB!.x, pA.y - pB!.y) / TILE) : 999;
        const self = await evalJS(cdp, sidA_tab, `(() => { const s=window.__ns?.scene; const me=s?.players.get(s.myId); return me ? {x:Math.round(me.worldX), y:Math.round(me.worldY), tgt:!!s.target, mv:!!s.movingTo, vis:document.visibilityState} : 'no-me'; })()`);
        console.log(`[reappro] walkNear i=${i} d=${d} self=${JSON.stringify(self)}`);
        if (d <= 3) return d;
      }
      return 999;
    };
    const dist0 = await walkNear();
    console.log(`[reappro] aproximación: dist=${dist0}`);

    // t0: cerca → RMS debe ser > 0 (CALIBRACIÓN: t0 fija el threshold relativo)
    await sleep(2500);
    const t0 = await rmsB(cdp, sidB);
    const chainInfo = await evalJS(cdp, sidB, `(() => { const s=window.__ns?.scene; const a=[...s.players.values()].find(q=>q.handle==='ReapproA'); if(!a) return 'A-no-en-mundo'; const pub=[...(s.lkRoom?.remoteParticipants.values()||[])].flatMap(p=>[...p.trackPublications.values()]).find(x=>x.kind==='audio'); return 'chain='+!!a.audioNode+' sub='+!!pub?.isSubscribed+' mute='+pub?.track?.isMuted; })()`);
    results.push(`t0-cerca: rms=${Number(t0.rms).toFixed(4)} ctx=${t0.ctx} ${chainInfo} meterErr=${t0.err} dbg=${t0.dbg}`);
    const T0 = Number(t0.rms);
    if (!(T0 > 0)) {
      results.push("t0 rms=0 → gate CIEGO (sin tono en el chain ni siquiera cerca). FAIL.");
      console.log("\n=== RESULTADOS reapproachprobe ===");
      results.forEach((r) => console.log(r));
      process.exit(2);
    }

    // lejos: caminar A a 12 tiles
    const far = { x: pB!.x + 12 * TILE * (pB!.x > 600 ? -1 : 1), y: pB!.y };
    await walkWithClient(cdp, sidA_tab, far);
    await sleep(4500);
    const t1 = await rmsB(cdp, sidB);
    const pAfar = await pos(cdp, sidB, "ReapproA");
    results.push(`t1-lejos: rms=${Number(t1.rms).toFixed(4)} dist=${pAfar && pB ? Math.round(Math.hypot(pAfar.x - pB.x, pAfar.y - pB.y) / TILE) : '?'} ctx=${t1.ctx}`);

    // volver: A regresa junto a B — con re-targeting (walkWithClient simple no
    // completaba: quedaba a 89 tiles, hallazgo del handoff 16-sep)
    for (let i = 0; i < 45; i++) {
      await cdp.send("Target.activateTarget", { targetId: await targetIdOf(cdp, sidA_tab) });
      await evalJS(cdp, sidA_tab, `(() => { const s=window.__ns?.scene; const b=[...s.players.values()].find(q=>q.handle==='ReapproB'); if(!b) return 'no-B'; s.target={x:b.worldX, y:b.worldY}; return 'ok'; })()`);
      await sleep(3000);
      const pA2 = await pos(cdp, sidB, "ReapproA");
      const d2 = pA2 && pB ? Math.round(Math.hypot(pA2.x - pB!.x, pA2.y - pB!.y) / TILE) : 999;
      if (d2 <= 3) break;
    }
    await sleep(3000);
    const t2 = await rmsB(cdp, sidB);
    const pAback = await pos(cdp, sidB, "ReapproA");
    const distBack = pAback && pB ? Math.round(Math.hypot(pAback.x - pB.x, pAback.y - pB.y) / TILE) : -1;
    // Criterio CALIBRADO (auditor 17-sep §3): relativo a t0, no absoluto.
    const RECOVERED = Number(t2.rms) > 0.5 * T0 && distBack <= 4;
    results.push(`t2-vuelta: rms=${Number(t2.rms).toFixed(4)} (req > ${(0.5 * T0).toFixed(4)}) dist=${distBack} ctx=${t2.ctx} who=${t2.who} dbg=${t2.dbg} → ${RECOVERED ? "PASS audio volvió" : "FAIL audio NO volvió (REPRO del bug)"}`);

    // Guardas anti-Falla-A: keepAlive muted/volume=0 y conteo de <audio>
    const g1 = await fallaAGuards(cdp, sidB);
    const GUARDS_OK = !!(g1 && g1.ok);
    console.log("[reappro] guardas raw:", JSON.stringify(g1));
    results.push(`guardas-FallaA: audioRemotes=${g1?.audioRemotes} audioEls=${g1?.audioEls} bad=[${(g1?.bad || []).join(";")}] → ${GUARDS_OK ? "PASS" : "FAIL"}`);

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

    // guardas también al final (tras el verdugo, cuando el watchdog pudo reconstruir)
    const g2 = await fallaAGuards(cdp, sidB);
    const GUARDS2_OK = !!(g2 && g2.ok);
    results.push(`guardas-FallaA-final: audioRemotes=${g2?.audioRemotes} audioEls=${g2?.audioEls} bad=[${(g2?.bad || []).join(";")}] → ${GUARDS2_OK ? "PASS" : "FAIL"}`);

    console.log("\n=== RESULTADOS reapproachprobe ===");
    results.forEach((r) => console.log(r));
    const repro = !RECOVERED || !R1OK || !GUARDS_OK || !GUARDS2_OK;
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


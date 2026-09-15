// Fase 5c (auditor, P0 audio conversacional): probe de 3 clientes headless
// con media fake contra PROD. Verifica: cada cliente publicado (mic vivo),
// suscrito a los 2 remotos, y 2 cadenas de audio creadas.
// Medición RMS con AnalyserNode en la cadena de cada remoto (directiva 2).
// Uso: npx tsx packages/server/scripts/voiceprobe3.ts [--local]
//Sin --local apunta a PROD (wss://api.turedvirtual.vip). plog local vía :2567.
import { spawn } from "child_process";
import { mkdirSync } from "fs";

const FF = "/usr/bin/firefox";
const LOCAL = process.argv.includes("--local");
const COLYSEUS = LOCAL ? "ws://127.0.0.1:2567" : "wss://api.turedvirtual.vip";
const ORIGIN = LOCAL ? "http://127.0.0.1:4175" : "https://play.turedvirtual.vip";
const SECS = parseInt(process.env.PROBE_SECS || "45");

function launchFF(handle: string, profile: string) {
  mkdirSync(profile, { recursive: true });
  const url = `${ORIGIN}/?probe=${handle}&probeUrl=${encodeURIComponent(COLYSEUS)}&voicetest=1`;
  return spawn(FF, ["--headless", "--no-remote", "--profile", profile, url],
    { stdio: "ignore", env: { ...process.env, MOZ_HEADLESS: "1" } });
}

async function main() {
  console.log(`voiceprobe3: colyseus=${COLYSEUS} secs=${SECS}`);
  const procs = [
    launchFF("vpA", `/tmp/gr-ff-vp-a-${Date.now()}`),
    // stagger 2s (singleton firefox — hallazgo gateC)
    await new Promise((r) => setTimeout(r, 2000)) as unknown as void,
  ][0] ? null : null; // placeholder para tipado; lanzamos secuencial abajo
  const handles = ["vpA", "vpB", "vpC"];
  const running: any[] = [];
  for (let i = 0; i < handles.length; i++) {
    running.push(launchFF(handles[i], `/tmp/gr-ff-vp-${handles[i]}-${Date.now()}`));
    await new Promise((r) => setTimeout(r, 2000)); // stagger singleton
  }
  await new Promise((r) => setTimeout(r, SECS * 1000));
  for (const p of running) { try { p.kill("SIGKILL"); } catch {} }
  console.log("voiceprobe3 done — leer /api/probelog (server 2567) para resultados");
  process.exit(0);
}
main();

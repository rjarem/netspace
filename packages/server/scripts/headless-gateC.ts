// Gate C round runner: 2 Firefox headless pages join via ?probe= bypass.
// NOTE: Chrome headless on this host cannot make HTTP connections (browser
// binary network blocked). Firefox works — and its WS to Colyseus was
// confirmed by the auditor. Profile dir must exist BEFORE invoking firefox.
// Usage: npx tsx headless-gateC.ts <round> [secs]
import { spawn } from "child_process";
import { mkdirSync } from "fs";

const FF = "/usr/bin/firefox";
const PROFILE_BASE = "/tmp/gr-ff-gateC";

function launchFF(handle: string, profile: string, secs: number) {
  mkdirSync(profile, { recursive: true }); // REQUIRED: firefox aborts otherwise
  const proc = spawn(FF, [
    "--headless", "--no-remote", "--profile", profile,
    `http://127.0.0.1:4175/?probe=${handle}`,
  ], { stdio: "ignore" });
  return new Promise<void>(res => setTimeout(() => {
    try { proc.kill("SIGKILL"); } catch {}; // SIGTERM no mata limpio: quedan sockets zombies que reconectan
    res();
  }, secs * 1000));
}

async function main() {
  const round = process.argv[2] || "1";
  const secs = parseInt(process.argv[3] || "10");
  // stagger 2s entre los DOS firefox del mismo round (hallazgo gateC-prod.sh:
  // firefox singleton — sin pausa el 2º pierde la carrera y no abre página).
  // secs=14 (antes 10): deja margen extra al arranque de firefox en VM.
  const a = launchFF(`gate${round}A`, `${PROFILE_BASE}-r${round}a-${Date.now()}`, Math.max(secs, 14));
  await new Promise((r) => setTimeout(r, 2000));
  const b = launchFF(`gate${round}B`, `${PROFILE_BASE}-r${round}b-${Date.now()}`, secs);
  await Promise.all([a, b]);
  console.log(`round ${round} done`);
  process.exit(0);
}
main();

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
  return new Promise<void>(res => setTimeout(() => { try { proc.kill("SIGTERM"); } catch {}; res(); }, secs * 1000));
}

async function main() {
  const round = process.argv[2] || "1";
  const secs = parseInt(process.argv[3] || "10");
  await Promise.all([
    launchFF(`gate${round}A`, `${PROFILE_BASE}-r${round}a`, secs),
    launchFF(`gate${round}B`, `${PROFILE_BASE}-r${round}b`, secs),
  ]);
  console.log(`round ${round} done`);
  process.exit(0);
}
main();

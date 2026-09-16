// Probe de AUDIO REAL end-to-end (Tito 16-sep noche): firefox con mic fake
// publica en netspace-world con identidad de usuario real; el Chrome-bot mide
// RMS en la cadena WebAudio. Diagnóstico del "no se oye a nadie".
import fs from "node:fs";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
const BASE = process.argv[2] || "http://127.0.0.1:2567";
const ORIGIN = process.argv[3] || "http://127.0.0.1:4176";
const ADMIN = process.env.ADMIN_TOKEN || "dev-admin";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const { Client } = await import("colyseus.js");
  const { AccessToken } = await import("livekit-server-sdk");
  const mintRes = await fetch(`${BASE}/api/invite`, { method: "POST", headers: { "x-admin-token": ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ handle: "FakeTone", role: "attendee", hours: 1 }) });
  const { token } = await (mintRes.json() as any);
  const real = await (new Client(BASE.replace("http", "ws"))).joinOrCreate("world", { token, handle: "FakeTone", isProbe: false });
  await sleep(800);
  const sessionId = (real as any).sessionId;
  const lkHost = process.env.LIVEKIT_HOST || "wss://livekit.turedvirtual.vip";
  const roomName = process.env.LIVEKIT_ROOM || "netspace-dev";
  const at = new AccessToken(process.env.LIVEKIT_API_KEY || "", process.env.LIVEKIT_API_SECRET || "", { identity: sessionId, name: "FakeTone", ttl: "10m" });
  at.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: false, canPublishData: true });
  const tok = (await at.toJwt()) as string;
  const profile = `/tmp/gr-ff-tone-${Date.now()}`;
  mkdirSync(profile, { recursive: true });
  fs.writeFileSync(`${profile}/user.js`, 'user_pref("media.navigator.streams.fake", true);\nuser_pref("media.navigator.permission.disabled", true);\nuser_pref("media.autoplay.default", 0);\n');
  const ff = spawn("/usr/bin/firefox", ["--headless", "--no-remote", "--profile", profile,
    `http://127.0.0.1:4176/tone-publisher.html?token=${encodeURIComponent(tok)}&url=${encodeURIComponent(lkHost)}`],
    { stdio: "ignore", env: { ...process.env, MOZ_HEADLESS: "1" } });
  console.log("FakeTone publicando identidad=" + sessionId + " sala=" + roomName + " — 60s de tono");
  await sleep(120000);
  ff.kill("SIGKILL");
  console.log("probe done");
  process.exit(0);
})().catch((e) => { console.error("ERR", e); process.exit(1); });

// H2 probe REAL (auditor Fase 6): usuario completo de verdad.
// 1) Une un cliente colyseus "RealPub" (como un usuario real)
// 2) Lanza un firefox que publica AUDIO REAL en LiveKit con la MISMA
//    identidad (sessionId) que mintearía el server para ese usuario
// 3) admin manda mod:mute → verifica vía Admin API que canPublish se revoca
// 4) desmute → verifica que se restaura
// Esto replica exactamente el flujo de un usuario real: identidad colyseus ==
// identidad LiveKit (identity=sessionId en sendLiveKitToken).
import fs from "node:fs";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
const BASE = process.argv[2] || "http://127.0.0.1:2567";
const ORIGIN = "http://127.0.0.1:4175";
const ADMIN = process.env.ADMIN_TOKEN || "dev-admin";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function mint(handle: string, role: string): Promise<string> {
  const r = await fetch(`${BASE.replace("ws", "http")}/api/invite`, { method: "POST", headers: { "x-admin-token": ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ handle, role, hours: 1 }) });
  return (await r.json()).token;
}
async function mintLive(handle: string, identity: string, canPublish: boolean): Promise<string> {
  const { AccessToken } = await import("livekit-server-sdk");
  const at = new AccessToken(process.env.LIVEKIT_API_KEY || "", process.env.LIVEKIT_API_SECRET || "", { identity, name: handle, ttl: "10m" });
  at.addGrant({ room: process.env.LIVEKIT_ROOM || "netspace-dev", roomJoin: true, canPublish, canSubscribe: false, canPublishData: true });
  return (await at.toJwt()) as string;
}
(async () => {
  const { Client } = await import("colyseus.js");
  const { RoomServiceClient } = await import("livekit-server-sdk");
  const lkHost = process.env.LIVEKIT_HOST || "wss://livekit.turedvirtual.vip";
  const roomName = process.env.LIVEKIT_ROOM || "netspace-dev";
  const svc = new RoomServiceClient(lkHost, process.env.LIVEKIT_API_KEY || "", process.env.LIVEKIT_API_SECRET || "");

  // 1) usuario colyseus "real"
  const real = await (new Client(BASE.replace("http", "ws"))).joinOrCreate("world", { token: await mint("RealPub", "attendee"), handle: "RealPub", isProbe: false });
  await sleep(800);
  const sessionId = (real as any).sessionId;

  // 2) firefox publica audio REAL con la identidad del sessionId
  const tok = await mintLive("RealPub", sessionId, true);
  const profile = `/tmp/gr-ff-h2real-${Date.now()}`;
  mkdirSync(profile, { recursive: true });
  fs.writeFileSync(`${profile}/user.js`, 'user_pref("media.navigator.streams.fake", true);\nuser_pref("media.navigator.permission.disabled", true);\nuser_pref("media.autoplay.default", 0);\n');
  const ff = spawn("/usr/bin/firefox", ["--headless", "--no-remote", "--profile", profile,
    `${ORIGIN}/lk-publisher.html?token=${encodeURIComponent(tok)}&url=${encodeURIComponent(lkHost)}`],
    { stdio: "ignore", env: { ...process.env, MOZ_HEADLESS: "1" } });

  // esperar publicación real
  let pub: any = null;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const parts = await svc.listParticipants(roomName);
    pub = (parts as any[]).find((p) => p.identity === sessionId);
    if (pub && (pub.tracks || []).length > 0) break;
  }
  const tracks = pub ? (pub.tracks || []).length : 0;
  console.log(`H2 precheck: RealPub identidad=${sessionId} tracks=${tracks} canPublish=${pub ? (pub.permission ? pub.permission.canPublish : true) : "?"}`);

  // 3) admin manda mute real
  const admin = await (new Client(BASE.replace("http", "ws"))).joinOrCreate("world", { token: await mint("RealMuteAdmin", "admin"), handle: "RealMuteAdmin", isProbe: true });
  await sleep(1200);
  admin.send("mod:mute", { handle: "RealPub", on: true });
  let revoked = false;
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    const parts = await svc.listParticipants(roomName);
    const p: any = (parts as any[]).find((x) => x.identity === sessionId);
    if (!p) { revoked = true; break; } // lo sacaron de voz = silenciado igual
    if (p.permission && p.permission.canPublish === false) { revoked = true; break; }
  }
  console.log(`${revoked ? "PASS" : "FAIL"} H2a-mute: canPublish revocado true→false`);

  admin.send("mod:mute", { handle: "RealPub", on: false });
  let restored = false;
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    const parts = await svc.listParticipants(roomName);
    const p: any = (parts as any[]).find((x) => x.identity === sessionId);
    if (p && p.permission && p.permission.canPublish === true) { restored = true; break; }
  }
  console.log(`${restored ? "PASS" : "FAIL"} H2b-unmute: canPublish restaurado false→true`);

  try { ff.kill("SIGKILL"); } catch {}
  const ok = revoked && restored;
  console.log(`---- h2realprobe: ${ok ? "PASS" : "FAIL"} ----`);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("h2real error:", e?.message || e); process.exit(2); });

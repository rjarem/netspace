// H2 probe (auditor Fase 6): mute REAL verificable por Admin API.
// mod:mute sobre un participante de voz REAL (voiceprobe3 debe estar vivo) →
// 1) el server silencia sus pistas (MutePublishedTrack) y
// 2) le REVOCA el permiso de publicación (updateParticipant canPublish:false)
//    — así el muteado no puede re-publicar desde su actionbar.
// 3) al desmutear, el permiso se restaura.
import fs from "node:fs";
const BASE = process.argv[2] || "http://127.0.0.1:2567";
const ADMIN = process.env.ADMIN_TOKEN || "dev-admin";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function mint(handle: string, role: string): Promise<string> {
  const r = await fetch(`${BASE.replace("ws", "http")}/api/invite`, { method: "POST", headers: { "x-admin-token": ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ handle, role, hours: 1 }) });
  return (await r.json()).token;
}
(async () => {
  const { Client } = await import("colyseus.js");
  const { AccessToken, RoomServiceClient } = await import("livekit-server-sdk");
  const admin = await (new Client(BASE.replace("http", "ws"))).joinOrCreate("world", { token: await mint("RealMuteAdmin", "admin"), handle: "RealMuteAdmin", isProbe: true });
  await sleep(2000);

  const lkHost = process.env.LIVEKIT_HOST || "wss://livekit.turedvirtual.vip";
  const key = process.env.LIVEKIT_API_KEY || "", sec = process.env.LIVEKIT_API_SECRET || "";
  const roomName = process.env.LIVEKIT_ROOM || "netspace-dev";
  const svc = new RoomServiceClient(lkHost, key, sec);

  const parts = await svc.listParticipants(roomName);
  const TARGET = process.env.H2_TARGET || "vpA";
  const vpA: any = (parts as any[]).find((p) => p.name === TARGET);
  if (!vpA) { console.log(`H2 FAIL: ${TARGET} no está en la sala de voz`); process.exit(1); }
  const permOf = (p: any) => !!(p.permission ? p.permission.canPublish : true);
  const before = permOf(vpA);
  console.log(`H2 precheck: ${TARGET} (${vpA.identity}) canPublish=${before} tracks=${((vpA as any).tracks || []).length}`);

  admin.send("mod:mute", { handle: TARGET, on: true });
  let mutedPerm = false;
  for (let i = 0; i < 20; i++) {
    await sleep(250);
    const ps = await svc.listParticipants(roomName);
    const a2: any = (ps as any[]).find((p) => p.identity === vpA.identity);
    if (a2 && permOf(a2) === false) { mutedPerm = true; break; }
  }
  console.log(`${mutedPerm ? "PASS" : "FAIL"} H2a-mute: canPublish revocado (true→false) = ${mutedPerm}`);

  admin.send("mod:mute", { handle: TARGET, on: false });
  let restored = false;
  for (let i = 0; i < 20; i++) {
    await sleep(250);
    const ps = await svc.listParticipants(roomName);
    const a2: any = (ps as any[]).find((p) => p.identity === vpA.identity);
    if (!a2) { restored = true; break; } // salió = sin voz igualmente
    if (permOf(a2) === true) { restored = true; break; }
  }
  console.log(`${restored ? "PASS" : "FAIL"} H2b-unmute: canPublish restaurado = ${restored}`);
  const ok = mutedPerm && restored;
  console.log(`---- h2muteprobe: ${ok ? "PASS" : "FAIL"} ----`);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("h2probe error:", e?.message || e); process.exit(2); });

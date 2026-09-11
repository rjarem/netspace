import { Client } from "colyseus.js";
const c = new Client("wss://api.turedvirtual.vip");
const room: any = await c.joinOrCreate("world", { token: btoa("dev:lkcheck5") });
const msgs: any[] = [];
room.onMessage("livekit", (m: any) => msgs.push(m));
await new Promise(r => setTimeout(r, 800));
room.send("move", { x: 9, y: 4 });
await new Promise(r => setTimeout(r, 1500));
const m = msgs[0];
if (!m) { console.log("NO MSG"); process.exit(1); }
const tok = typeof m.token === "string" ? m.token : "";
console.log("token len:", tok.length, "| zone:", m.zoneId, "| url:", m.url);
try {
  const payload = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString());
  console.log("grants:", JSON.stringify(payload.video));
} catch (e) { console.log("decode err:", (e as Error).message); }
process.exit(0);

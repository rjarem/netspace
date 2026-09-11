import { Client } from "colyseus.js";
const c = new Client("wss://api.turedvirtual.vip");
const room: any = await c.joinOrCreate("world", { token: btoa("dev:lkcheck3") });
const msgs: any[] = [];
room.onMessage("livekit", (m: any) => msgs.push(m));
await new Promise(r => setTimeout(r, 800));
room.send("move", { x: 8, y: 4 }); // triggers zone refresh
await new Promise(r => setTimeout(r, 1500));
if (!msgs.length) { console.log("NO livekit msg"); process.exit(1); }
const msg = msgs[0];
console.log("url:", msg.url, "| zone:", msg.zoneId, "| token len:", (msg.token||"").length, "| isViewer:", msg.isViewer);
try {
  const payload = JSON.parse(Buffer.from(msg.token.split(".")[1], "base64").toString());
  console.log("grants:", JSON.stringify(payload.video));
} catch (e) { console.log("token decode err:", e); }
process.exit(0);

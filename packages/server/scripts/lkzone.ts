import { Client } from "colyseus.js";
const c = new Client("wss://api.turedvirtual.vip");
const room: any = await c.joinOrCreate("world", { token: btoa("dev:zonecheck") });
const msgs: any[] = [];
room.onMessage("livekit", (m: any) => msgs.push({zone: m.zoneId, len: (m.token||"").length, url: m.url}));
await new Promise(r => setTimeout(r, 800));
// spawn is 7,4; DJ lounge x1-6 y2-5 → move left
room.send("move", { x: 7, y: 14 });
await new Promise(r => setTimeout(r, 1200));
room.send("move", { x: 8, y: 15 });
await new Promise(r => setTimeout(r, 1200));
console.log(JSON.stringify(msgs));
process.exit(0);

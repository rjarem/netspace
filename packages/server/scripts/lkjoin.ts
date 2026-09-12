import { Client } from "colyseus.js";
const c = new Client("wss://api.turedvirtual.vip");
const room: any = await c.joinOrCreate("world", { token: btoa("dev:joinfix") });
const msgs: any[] = [];
room.onMessage("livekit", (m: any) => msgs.push({zone: m.zoneId, len: (m.token||"").length}));
await new Promise(r => setTimeout(r, 3000)); // no move at all
console.log("msgs on join:", JSON.stringify(msgs));
process.exit(0);

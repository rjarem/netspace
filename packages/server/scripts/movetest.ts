import { Client } from "colyseus.js";
const c = new Client("wss://api.turedvirtual.vip");
const room: any = await c.joinOrCreate("world", { token: btoa("dev:movetest") });
let last: any = {};
room.onStateChange((s: any) => { const p = s.players.get(room.sessionId); if (p) last = { x: p.x, y: p.y }; });
await new Promise(r => setTimeout(r, 1500));
console.log("start:", JSON.stringify(last));
// UP means y-1 in world coords. Send it directly:
room.send("move", { x: last.x, y: last.y - 1 });
await new Promise(r => setTimeout(r, 600));
console.log("after up-1:", JSON.stringify(last));
room.send("move", { x: last.x, y: last.y - 1 });
await new Promise(r => setTimeout(r, 600));
console.log("after up-2:", JSON.stringify(last));
process.exit(0);

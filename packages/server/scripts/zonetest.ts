import { Client } from "colyseus.js";
const c = new Client("wss://api.turedvirtual.vip");
const room: any = await c.joinOrCreate("world", { token: btoa("dev:zonetest") });
await new Promise(r => setTimeout(r, 800));
const get = () => { const p: any = {}; room.state.players.forEach((v, k) => p[k] = { x: v.x, y: v.y, zone: v.inStage }); return p[room.sessionId]; };
console.log("spawn:", JSON.stringify(get()));
// try to walk into DJ Lounge (x:26-33, y:6-11)
room.send("move", { x: 28, y: 8 });
await new Promise(r => setTimeout(r, 500));
console.log("inside DJ Lounge attempt:", JSON.stringify(get()));
// try main stage (15-24, 2-6)
room.send("move", { x: 18, y: 4 });
await new Promise(r => setTimeout(r, 500));
console.log("inside Main Stage attempt:", JSON.stringify(get()));
process.exit(0);

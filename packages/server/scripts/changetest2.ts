import { Client } from "colyseus.js";
const c = new Client("wss://api.turedvirtual.vip");
const obs: any = await c.joinOrCreate("world", { token: btoa("dev:observer2") });
let moveFired = 0;
obs.state.players.onChange((p: any, id: string) => { moveFired++; });
// register listener AFTER join completes, watch for a move of another existing player
await new Promise((r) => setTimeout(r, 800));
// find existing mover
const mover: any = await c.joinOrCreate("world", { token: btoa("dev:moverx") });
await new Promise((r) => setTimeout(r, 400));
const me0 = { x: 0, y: 0 };
mover.send("move", { x: 15, y: 15 });
await new Promise((r) => setTimeout(r, 600));
mover.send("move", { x: 16, y: 16 });
await new Promise((r) => setTimeout(r, 800));
console.log("observer onChange fired:", moveFired);
process.exit(0);

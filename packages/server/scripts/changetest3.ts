import { Client } from "colyseus.js";
const c = new Client("wss://api.turedvirtual.vip");
const obs: any = await c.joinOrCreate("world", { token: btoa("dev:obs3") });
// log every onChange with payload
obs.state.players.onChange((p: any, id: string) => console.log("CHG", id, p.x, p.y, JSON.stringify(p)));
await new Promise((r) => setTimeout(r, 1000));
const mover: any = await c.joinOrCreate("world", { token: btoa("dev:moverz") });
await new Promise((r) => setTimeout(r, 400));
mover.send("move", { x: 25, y: 25 });
await new Promise((r) => setTimeout(r, 1000));
process.exit(0);

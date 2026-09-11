import { Client } from "colyseus.js";
const c = new Client("wss://api.turedvirtual.vip");
const obs: any = await c.joinOrCreate("world", { token: btoa("dev:obs4") });
let chgAfterJoin = 0;
await new Promise((r) => setTimeout(r, 1000));
// Now attach listener and move EXISTING player obs4 itself
obs.state.players.onChange((p: any, id: string) => { chgAfterJoin++; console.log("AFTER", id, p.x, p.y); });
obs.send("move", { x: 9, y: 4 });
await new Promise((r) => setTimeout(r, 800));
console.log("self-move onChange:", chgAfterJoin);
process.exit(0);

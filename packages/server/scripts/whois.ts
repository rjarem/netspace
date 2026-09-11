import { Client } from "colyseus.js";
const c = new Client("wss://api.turedvirtual.vip");
const room: any = await c.joinOrCreate("world", { token: btoa("dev:whois") });
await new Promise(r => setTimeout(r, 1200));
const all: any[] = [];
room.state.players.forEach((p: any, id: string) => all.push({ handle: p.handle, x: p.x, y: p.y }));
console.log(JSON.stringify(all));
process.exit(0);

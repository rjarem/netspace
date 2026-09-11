import { Client } from "colyseus.js";
const c = new Client("wss://api.turedvirtual.vip");
const room: any = await c.joinOrCreate("world", { token: btoa("dev:watcher") });
room.state.players.onAdd((p: any, id: string) => {
  p.onChange = () => console.log("MOVE", id.slice(-4), p.handle, "->", p.x, p.y);
});
await new Promise(r => setTimeout(r, 20000));
console.log("done watching");
process.exit(0);

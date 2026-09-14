import { Client } from "colyseus.js";
async function main() {
  const c = new Client("wss://api.turedvirtual.vip");
  const a = await c.joinOrCreate("world", { token: btoa("dev:pairA") });
  await new Promise(r => setTimeout(r, 1200));
  const c2 = new Client("wss://api.turedvirtual.vip");
  const b = await c2.joinOrCreate("world", { token: btoa("dev:pairB") });
  await new Promise(r => setTimeout(r, 800));
  console.log("pairA room", a.id.slice(0,6), "players", a.state.players.size, "| pairB room", b.id.slice(0,6), "players", b.state.players.size);
  a.leave(); b.leave(); process.exit(0);
}
main().catch(e => { console.log("ERR", e.message); process.exit(1); });

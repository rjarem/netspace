import { Client } from "colyseus.js";

async function main(tag: string) {
  const c = new Client("wss://api.turedvirtual.vip");
  const a = await c.joinOrCreate("world", { token: btoa(`dev:${tag}`) });
  await new Promise((r) => setTimeout(r, 800));
  console.log(tag, "room", a.id.slice(0, 6), "players", a.state.players.size);
  await new Promise((r) => setTimeout(r, 4000));
  a.leave();
  process.exit(0);
}
main(process.argv[2]).catch((e) => { console.log("ERR", e.message); process.exit(1); });

import { Client } from "colyseus.js";
async function main() {
  const c = new Client("wss://api.turedvirtual.vip");
  const a = await c.joinOrCreate("world", { token: btoa("dev:visA") });
  await new Promise(r => setTimeout(r, 1500));
  const b = await c.joinOrCreate("world", { token: btoa("dev:visB") });
  await new Promise(r => setTimeout(r, 1500));
  const countA = a.state.players.size;
  const countB = b.state.players.size;
  console.log(`A sees ${countA} players, B sees ${countB} players`);
  a.leave(); b.leave();
  process.exit(0);
}
main().catch(e => { console.log("PROBE-ERR", e.message); process.exit(1); });

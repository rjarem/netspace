import { Client } from "colyseus.js";

// Fase 0 verification probe (local): joins, reads serverBuild from state,
// checks structured join log presence indirectly via SHA. Exits 0 on success.
async function main() {
  const c = new Client("ws://localhost:2567");
  const room = await c.joinOrCreate("world", { token: btoa("dev:fase0probe") });
  let sha = "";
  await new Promise<void>((res) => {
    const t = setTimeout(() => res(), 2500);
    room.onStateChange((st: any) => {
      if (st?.serverBuild) { sha = st.serverBuild; clearTimeout(t); res(); }
    });
    setTimeout(() => { if ((room.state as any)?.serverBuild) { sha = (room.state as any).serverBuild; clearTimeout(t); res(); } }, 300);
  });
  console.log("serverBuild:", sha || "(missing)");
  console.log("roomId:", room.id, "players:", room.state.players.size);
  room.leave();
  process.exit(sha ? 0 : 1);
}
main().catch(e => { console.log("ERR", e.message); process.exit(1); });

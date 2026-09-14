import { Client } from "colyseus.js";
(async () => {
  const c = new Client("ws://localhost:2567");
  const room = await c.joinOrCreate("world", { token: btoa("dev:probeD") });
  await room.connection.ready ? null : null;
  await new Promise(r => setTimeout(r, 500));
  const me = room.state.players.get(room.sessionId);
  console.log("spawn", me.x, me.y);
  // 1) small drag (should move if not blocked)
  room.send("drag", { x: me.x + 2, y: me.y });
  await new Promise(r => setTimeout(r, 400));
  console.log("after small drag", room.state.players.get(room.sessionId)!.x, room.state.players.get(room.sessionId)!.y);
  // 2) teleport attempt (should be REJECTED: stays)
  room.send("drag", { x: 120, y: 60 });
  await new Promise(r => setTimeout(r, 400));
  console.log("after jump attempt", room.state.players.get(room.sessionId)!.x, room.state.players.get(room.sessionId)!.y);
  // 3) click-to-move still works
  room.send("move", { x: room.state.players.get(room.sessionId)!.x + 1, y: room.state.players.get(room.sessionId)!.y });
  await new Promise(r => setTimeout(r, 400));
  console.log("after move", room.state.players.get(room.sessionId)!.x, room.state.players.get(room.sessionId)!.y);
  room.leave(); process.exit(0);
})().catch(e => { console.error("PROBE-ERR", e.message); process.exit(1); });

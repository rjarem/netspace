// Smoke test: join WorldRoom via WebSocket with invite token
import { Client } from "colyseus.js";

const token = process.argv[2];
if (!token) { console.error("usage: node smoke.js <token>"); process.exit(1); }

const client = new Client("ws://localhost:2569");
const room = await client.joinOrCreate("world", { token });

room.onStateChange((state: any) => {
  const players = Object.values(state.players || {})
    .map((p: any) => p?.handle)
    .filter(Boolean);
  console.log("[state] players:", players.join(", ") || "(none)");
});

room.onMessage("proximity", (data) => {
  console.log("[proximity] me:", Object.keys(data[room.sessionId] || {}).length, "neighbors");
});

room.send("move", { x: 8, y: 8 });
await new Promise((r) => setTimeout(r, 600));
room.send("move", { x: 21, y: 3 }); // try to enter Main Stage (admin should be allowed)
await new Promise((r) => setTimeout(r, 600));
console.log("[done] session:", room.sessionId);
await room.leave(true);
process.exit(0);
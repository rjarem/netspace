// Probe state sync: what does the client actually receive?
import { Client } from "colyseus.js";
import { fileURLToPath } from "url";

const c = new Client("ws://localhost:2569");
const room: any = await c.joinOrCreate("world", { token: btoa("dev:probe") });
await new Promise((r) => setTimeout(r, 1500));

const handles: string[] = [];
room.state.players.forEach((p: any, id: string) => handles.push(`${id}:${p?.handle}`));
console.log("forEach players:", handles.join(",") || "(empty)");

const raw = JSON.parse(JSON.stringify(room.state));
console.log("raw players:", JSON.stringify(raw.players).slice(0, 400));
process.exit(0);

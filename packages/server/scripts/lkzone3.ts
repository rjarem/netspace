import { Client } from "colyseus.js";
const c = new Client("wss://api.turedvirtual.vip");
const room: any = await c.joinOrCreate("world", { token: btoa("dev:zonecheck3") });
const msgs: any[] = [];
room.onMessage("livekit", (m: any) => msgs.push({zone: m.zoneId, len: (m.token||"").length}));
let px=6, py=4;
let mypos = "";
room.state.players.onAdd((p: any, id: string) => { if(id===room.sessionId){p.onChange=()=>{mypos=p.x+","+p.y}; mypos=p.x+","+p.y;} });
await new Promise(r => setTimeout(r, 800));
// walk down to y=15 (x=6), watching each step
const seq: number[][] = [];
for (let y=5; y<=15; y++) seq.push([6,y]);
for (let x=7; x<=8; x++) seq.push([x,15]);
for (const [x,y] of seq) {
  room.send("move", { x, y });
  await new Promise(r => setTimeout(r, 250));
}
await new Promise(r => setTimeout(r, 1500));
console.log("final pos:", mypos, "msgs:", JSON.stringify(msgs));
process.exit(0);

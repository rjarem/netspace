import { Client } from "colyseus.js";
const ADMIN = process.env.ADMIN_TOKEN || "";
async function mint(handle: string, role = "admin"): Promise<string> {
  const r = await fetch("https://api.turedvirtual.vip/api/invite", { method: "POST", headers: { "x-admin-token": ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ handle, role, hours: 1 }) });
  return (await r.json()).token;
}
const token = await mint("ObserverProd");
const c = new Client("wss://api.turedvirtual.vip");
const room = await c.joinOrCreate("world", { token, handle: "ObserverProd", isProbe: true });
await new Promise((r) => setTimeout(r, 2500));
const ps: any[] = [];
room.state.players.forEach((p: any, k: string) => ps.push({ k, handle: p.handle, role: p.role, micOn: p.micOn, mutedBy: p.mutedBy || null, isProbe: p.isProbe }));
console.log("players:", JSON.stringify(ps, null, 1));
process.exit(0);

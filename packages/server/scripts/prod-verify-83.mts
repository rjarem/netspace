// Verificación completa 8.3 en PROD: attendee NO mintea + admin SÍ + shortlink
import { Client } from "colyseus.js";
const ADMIN = process.env.ADMIN_TOKEN || "";
async function mint(handle: string, role: string): Promise<any> {
  const r = await fetch("https://api.turedvirtual.vip/api/invite", { method: "POST", headers: { "x-admin-token": ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ handle, role, hours: 1 }) });
  return { status: r.status, ...(await r.json()) };
}
const admin = await mint("SmokeAdmin", "admin");
if (!admin.token) { console.log("FAIL mint api admin", admin.status); process.exit(1); }
const c = new Client("wss://api.turedvirtual.vip");
const roomA = await c.joinOrCreate("world", { token: admin.token, handle: "SmokeAdmin", isProbe: true });
await new Promise((r) => setTimeout(r, 2000));
const resp: any = await new Promise((res) => {
  roomA.onMessage("invite:minted", (m: any) => res(m));
  roomA.send("admin:mint", { handle: "InvitadoProd", hours: 1 });
  setTimeout(() => res(null), 8000);
});
console.log(resp ? `1) ADMIN mintea: OK role=${resp.role}` : "1) ADMIN mintea: FAIL (null)");
// attendee: join con token de rol attendee e intentar admin:mint — NO debe recibir minted
const att = await mint("SmokeAttendee", "attendee");
if (!att.token) { console.log("FAIL mint api attendee", att.status); process.exit(1); }
const roomB = await c.joinOrCreate("world", { token: att.token, handle: "SmokeAttendee", isProbe: true });
await new Promise((r) => setTimeout(r, 2000));
const attResp: any = await new Promise((res) => {
  roomB.onMessage("invite:minted", (m: any) => res(m));
  roomB.send("admin:mint", { handle: "HackAttempt", hours: 1 });
  setTimeout(() => res(null), 6000);
});
console.log(attResp ? "2) ATTENDEE mintea: VIOLACIÓN — recibió minted" : "2) ATTENDEE mintea: OK — rechazado silencioso");
roomA.leave(); roomB.leave();
process.exit(0);

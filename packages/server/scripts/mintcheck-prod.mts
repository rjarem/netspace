// Smoke 8.3 contra PROD: mint vía API + envío admin:mint por Colyseus
import { Client } from "colyseus.js";
const ADMIN = process.env.ADMIN_TOKEN || "";
const r = await fetch("https://api.turedvirtual.vip/api/invite", { method: "POST", headers: { "x-admin-token": ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ handle: "MintSmoke", role: "admin", hours: 1 }) });
const jr: any = await r.json();
if (!jr.token) { console.log("MINT_API_FAIL", r.status, JSON.stringify(jr).slice(0, 120)); process.exit(1); }
const c = new Client("wss://api.turedvirtual.vip");
const room = await c.joinOrCreate("world", { token: jr.token, handle: "MintSmoke", isProbe: true });
await new Promise((r2) => setTimeout(r2, 2000));
const resp: any = await new Promise((res) => {
  room.onMessage("invite:minted", (m: any) => res(m));
  room.send("admin:mint", { handle: "SmokeInvitado", hours: 1 });
  setTimeout(() => res(null), 8000);
});
console.log(resp ? `MINT_OK role=${resp.role} ttl=${resp.exp ? Math.round((resp.exp - Date.now() / 1000) / 60) + "min" : "?"} code=${resp.code ? "sí" : "no"}` : "MINT_NULL — handler NO registrado en prod");
process.exit(0);

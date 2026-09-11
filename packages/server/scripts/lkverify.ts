import { AccessToken } from "livekit-server-sdk";
import { Client } from "colyseus.js";
const c = new Client("wss://api.turedvirtual.vip");
const room: any = await c.joinOrCreate("world", { token: btoa("dev:verify1") });
const msgs: any[] = [];
room.onMessage("livekit", (m: any) => msgs.push(m));
await new Promise(r => setTimeout(r, 800));
room.send("move", { x: 8, y: 7 });
await new Promise(r => setTimeout(r, 1200));
const m = msgs[0];
if (!m?.token) { console.log("NO TOKEN MSG"); process.exit(1); }
const jwt = m.token as string;
const [h, p, s] = jwt.split(".");
const crypto = await import("crypto");
const sig = crypto.createHmac("sha256", "devsecret-change-me").update(`${h}.${p}`).digest("base64url");
console.log("sig match:", sig === s, "| len:", jwt.length, "| url:", m.url);
const claims = JSON.parse(Buffer.from(p, "base64").toString());
console.log("claims:", JSON.stringify(claims).slice(0, 220));
process.exit(0);

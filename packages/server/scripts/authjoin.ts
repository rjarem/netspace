// Fase 5b — join con token de invitación (para gate-auth.sh).
// Auth options de Colyseus: el server valida JWT antes de onJoin cuando
// la auth está activa (DEV_NO_AUTH != 1).
// Exit con última línea: JOIN-OK:<roomId>:<role> | JOIN-REJECT:<motivo>
import { Client } from "colyseus.js";

const url = process.env.PROBE_URL || "http://localhost:2567";
const handle = process.env.AUTH_HANDLE || "authgate";
const token = process.env.AUTH_TOKEN || "";

const c = new Client(url);
try {
  // El JWT de invitación viaja en options.token (el server lo valida en
  // onAuth). Sin JWT, manda dev-token (solo aceptado con DEV_NO_AUTH=1).
  const joinToken = token || btoa(`dev:${handle}`);
  const room: any = await c.joinOrCreate("world", { token: joinToken });
  const state: any = room.state;
  // leer role de MI player (busca por sessionId propio)
  let role = "";
  for (let i = 0; i < 20; i++) {
    const me = state.players.get(room.sessionId);
    if (me) { role = me.role; break; }
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(`JOIN-OK:${room.id}:${role}`);
  process.exit(0);
} catch (e: any) {
  console.log(`JOIN-REJECT:${(e?.message || "error").slice(0, 120)}`);
  process.exit(1);
}

// Fase 5b — mintea un JWT con un secreto ARBITRARIO (para el caso 4 del gate:
// token firmado con secreto viejo/rotado debe ser rechazado).
import { signInviteToken } from "../src/jwt.js";

const secret = process.env.OLD_SECRET || "secret-viejo";
const handle = process.env.AUTH_HANDLE || "oldsecret";
const exp = Math.floor(Date.now() / 1000) + 3600;
const token = await signInviteToken(secret, { handle, role: "attendee", exp });
console.log(token);
process.exit(0);

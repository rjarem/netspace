// Invite endpoints — JWTs para room auth + links cortos (Ciclo 3)
import express, { Router } from "express";
import { signInviteToken } from "./jwt.js";
import { loadLinks, saveLinks, createShortlink } from "./shortlinks.js";
// === Ciclo 3 (plan auditor 17-sep): links cortos ===
// 6 chars Crockford base32 sin ambiguos (32⁶ ≈ 10⁹), GET /i/:code → 302 a
// /?invite=<jwt> (cero cambios de cliente), persistencia patrón bans.json,
// TTL = exp del JWT, rate-limit 10/min/IP, revocación → 410.
const ipWindow = new Map();
function rateLimitIp(ip, limit = 10, windowMs = 60_000) {
    const now = Date.now();
    const e = ipWindow.get(ip);
    if (!e || now > e.reset) {
        ipWindow.set(ip, { n: 1, reset: now + windowMs });
        return true;
    }
    e.n++;
    return e.n <= limit;
}
// 302 al CLIENTE (dominio del juego), no al API — env CLIENT_ORIGIN
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "https://play.turedvirtual.vip";
export function inviteRouter() {
    const r = Router();
    r.use(express.json());
    r.post("/api/invite", async (req, res) => {
        const adminToken = req.headers["x-admin-token"];
        if (adminToken !== (process.env.ADMIN_TOKEN || "dev-admin")) {
            return res.status(401).json({ error: "unauthorized" });
        }
        const { handle, role, hours } = req.body || {};
        // 16-sep (Tito): handle OPCIONAL — sin handle = invitación de EVENTO
        // (link genérico para N invitados, cada quien elige su nombre).
        const validRoles = ["admin", "moderator", "speaker", "attendee", "panelist", "dj"];
        const r2 = validRoles.includes(role) ? role : "attendee";
        // Ciclo 5 (auditor): TTL configurable, cap 7 días (168h)
        const hrs = Math.max(1, Math.min(168, Number(hours) || 24));
        const exp = Math.floor(Date.now() / 1000) + hrs * 3600;
        const secret = process.env.JWT_SECRET || "dev-secret-change-me";
        const token = await signInviteToken(secret, { handle: handle || "", role: r2, exp });
        res.json({ token, role: r2, exp, event: !handle });
    });
    // --- Links cortos ---
    // Crear (admin token): body {token} JWT ya minteado, o {role, hours} para
    // mintear+encurtir en un paso.
    r.post("/api/shortlink", async (req, res) => {
        if (req.headers["x-admin-token"] !== (process.env.ADMIN_TOKEN || "dev-admin")) {
            return res.status(401).json({ error: "unauthorized" });
        }
        let token = String(req.body?.token || "");
        let exp = 0;
        if (!token) {
            const hours = Math.max(1, Number(req.body?.hours) || 72);
            exp = Math.floor(Date.now() / 1000) + hours * 3600;
            token = await signInviteToken(process.env.JWT_SECRET || "dev-secret-change-me", { handle: "", role: "attendee", exp });
        }
        else {
            try {
                exp = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString("utf8")).exp || 0;
            }
            catch {
                return res.status(400).json({ error: "token inválido" });
            }
            for (const [k, v] of loadLinks())
                if (v.jwt === token)
                    return res.json({ code: k, url: `/i/${k}`, exp });
        }
        const code = createShortlink(token, exp, String(req.body?.createdBy || "admin"));
        res.json({ code, url: `/i/${code}`, exp, token });
    });
    // Resolver: 302 si vigente, 410 si revocado, 404 si no existe.
    r.get("/i/:code", (req, res) => {
        if (!rateLimitIp(req.ip || "unknown"))
            return res.status(429).send("too many requests");
        const e = loadLinks().get(String(req.params.code).toLowerCase());
        if (!e)
            return res.status(404).send("not found");
        if (e.revoked)
            return res.status(410).send("gone");
        if (e.exp && Date.now() / 1000 > e.exp)
            return res.status(410).send("expired");
        // 302 al cliente con el JWT — cero cambios de cliente (auditor)
        res.set("Location", `${CLIENT_ORIGIN}/?invite=${encodeURIComponent(e.jwt)}`);
        return res.status(302).send();
    });
    // --- Ciclo 5 (auditor §3): listado de links activos — SOLO con ADMIN_TOKEN,
    // sin exponer JWTs. Para la página /admin.
    r.get("/api/shortlinks", (req, res) => {
        if (req.headers["x-admin-token"] !== (process.env.ADMIN_TOKEN || "dev-admin")) {
            return res.status(401).json({ error: "unauthorized" });
        }
        const links = loadLinks();
        const out = [];
        for (const [code, e] of links) {
            let role = "attendee";
            try {
                const mid = String(e.jwt).split(".")[1];
                const b = JSON.parse(Buffer.from(mid, "base64url").toString("utf8"));
                role = String(b.role || "attendee");
            }
            catch { /* */ }
            out.push({ code, role, exp: e.exp, createdBy: String(e.createdBy || ""), revoked: !!e.revoked });
        }
        res.json({ links: out });
    });
    // Revocar: admin token O el creador demostrando el JWT original.
    r.post("/api/shortlink/revoke", (req, res) => {
        const isAdmin = req.headers["x-admin-token"] === (process.env.ADMIN_TOKEN || "dev-admin");
        const code = String(req.body?.code || "").toLowerCase();
        const links = loadLinks();
        const e = links.get(code);
        if (!e)
            return res.status(404).json({ error: "not found" });
        if (!isAdmin && req.body?.token !== e.jwt)
            return res.status(401).json({ error: "unauthorized" });
        e.revoked = true;
        links.set(code, e);
        saveLinks(links);
        console.log(`[shortlink] revocado code=${code}`);
        // Nota documentada (auditor): el JWT largo sigue válido hasta exp — la
        // revocación solo mata el link corto.
        res.json({ ok: true, note: "el JWT largo sigue válido hasta exp" });
    });
    return r;
}

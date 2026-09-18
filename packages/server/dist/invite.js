// Invite endpoints — JWTs para room auth + links cortos (Ciclo 3)
import express, { Router } from "express";
import { signInviteToken } from "./jwt.js";
import { loadLinks, saveLinks, createShortlink } from "./shortlinks.js";
import crypto from "node:crypto";
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
// --- Ciclo 6.1 (auditor): fail-closed + timing-safe, UN solo lugar ---
// Sin ADMIN_TOKEN en env → NUNCA autoriza (antes: invite.ts caía a
// "dev-admin" mientras /api/mod caía a ""). timingSafeEqual en ambos
// caminos para eliminar la señal de timing. Exportado para /api/mod
// (index.ts) — un solo criterio de autorización en todo el server.
export function adminOk(req) {
    const expected = process.env.ADMIN_TOKEN || "";
    if (!expected)
        return false; // fail-closed: sin env → NUNCA autoriza
    const a = Buffer.from(String(req.headers["x-admin-token"] || ""), "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length) {
        // misma cantidad de trabajo en ambos caminos (timing uniforme)
        crypto.timingSafeEqual(Buffer.alloc(a.length + b.length, 1), Buffer.alloc(a.length + b.length, 1));
        return false;
    }
    return crypto.timingSafeEqual(a, b);
}
// CICLO 9.2 (plan firmado 2026-09-18): rate-limit de auth admin fallida —
// control compensatorio para ADMIN_TOKEN elegible. CHOKE POINT ÚNICO
// (auditor, coherente con 6.1): todos los endpoints admin pasan por aquí.
// Reglas de firma:
//  - SOLO cuentan fallos con header x-admin-token PRESENTE (ciclo61-f hace
//    5-6 requests sin header esperando 401 — no se incrementa).
//  - 5 fallos permitidos por IP/min; el 6º intento → 429.
//  - Mapa SEPARADO de ipWindow (resolve) → ciclo6b-g intacto por construcción.
//  - Éxito auténtico resetea el contador de la IP.
const adminFail = new Map();
const ADMIN_FAIL_LIMIT = 5;
const ADMIN_FAIL_WINDOW_MS = 60_000;
export function adminGate(req, res) {
    const hdr = req.headers["x-admin-token"];
    const hasHdr = typeof hdr === "string" && hdr.length > 0;
    const ip = String(req.ip || "unknown");
    const e = adminFail.get(ip);
    if (hasHdr && e && Date.now() < e.reset && e.n >= ADMIN_FAIL_LIMIT) {
        res.status(429).json({ error: "too many attempts" });
        return false;
    }
    if (adminOk(req)) {
        if (hasHdr)
            adminFail.delete(ip);
        return true;
    }
    if (hasHdr) {
        if (!e || Date.now() >= e.reset)
            adminFail.set(ip, { n: 1, reset: Date.now() + ADMIN_FAIL_WINDOW_MS });
        else
            e.n++;
    }
    res.status(401).json({ error: "unauthorized" });
    return false;
}
export function inviteRouter() {
    const r = Router();
    r.use(express.json());
    // Sanitización en origen (auditor 6.1, defensa en profundidad del XSS de
    // /admin): createdBy es handle libre del body — nunca debe llegar a HTML
    const sanitizeCreatedBy = (s) => s.replace(/[<>&"']/g, "");
    r.post("/api/invite", async (req, res) => {
        if (!adminGate(req, res))
            return;
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
        if (!adminGate(req, res))
            return;
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
        const createdBy = String(req.body?.createdBy || "admin"); // sanitizado dentro de createShortlink (choke point único, auditor 6b)
        const code = createShortlink(token, exp, createdBy);
        res.json({ code, url: `/i/${code}`, exp, token });
    });
    // --- Ciclo 6b (auditor-firmado): resolve de código corto para la Antesala.
    // Path (no querystring): los códigos son credenciales — fuera de access logs.
    // Devuelve JSON {jwt, exp} (no 302: el cliente no puede leer Location cross-
    // origin). CORS restrictivo a CLIENT_ORIGIN. Códigos muertos → 404/410 SIN
    // jwt. Sin ADMIN_TOKEN: la credencial es el código (igual que /i/:code).
    r.get("/api/shortlink/resolve/:code", (req, res) => {
        res.set("Access-Control-Allow-Origin", CLIENT_ORIGIN);
        res.set("Vary", "Origin");
        if (!rateLimitIp(req.ip || "unknown"))
            return res.status(429).json({ error: "too many requests" });
        const e = loadLinks().get(String(req.params.code).toLowerCase());
        if (!e)
            return res.status(404).json({ error: "invalid" });
        if (e.revoked)
            return res.status(410).json({ error: "invalid" });
        if (e.exp && Date.now() / 1000 > e.exp)
            return res.status(410).json({ error: "invalid" });
        res.json({ jwt: e.jwt, exp: e.exp });
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
        if (!adminGate(req, res))
            return;
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
        // CICLO 9.2: si trae header admin, pasa por el gate (cuenta fallos);
        // sin header → vía creador-JWT, sin incrementar contador.
        const hdr = req.headers["x-admin-token"];
        if (typeof hdr === "string" && hdr.length > 0) {
            if (!adminGate(req, res))
                return;
        }
        const isAdmin = adminOk(req);
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

// Ciclo 3: persistencia de links cortos — patrón bans.json (auditor)
import fs from "node:fs";
import path from "node:path";
const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz"; // sin i,l,o,u (auditor)
export function shortFile() {
    return path.resolve(process.env.SHORTLINKS_FILE || "shortlinks.json");
}
export function loadLinks() {
    try {
        return new Map(Object.entries(JSON.parse(fs.readFileSync(shortFile(), "utf8"))));
    }
    catch {
        return new Map();
    }
}
export function saveLinks(m) {
    fs.writeFileSync(shortFile(), JSON.stringify(Object.fromEntries(m), null, 2));
}
export function genCode() {
    const buf = new Uint8Array(6);
    crypto.getRandomValues(buf);
    let s = "";
    for (let i = 0; i < 6; i++)
        s += CROCKFORD[buf[i] % 32];
    return s;
}
/** Crea un shortlink para un JWT ya firmado. Devuelve el código. */
export function createShortlink(jwt, exp, createdBy) {
    const links = loadLinks();
    let code = genCode();
    while (links.has(code))
        code = genCode();
    links.set(code, { jwt, exp, revoked: false, createdAt: Date.now(), createdBy });
    saveLinks(links);
    console.log(`[shortlink] creado code=${code} exp=${exp} by=${createdBy}`);
    return code;
}

import { Client } from "colyseus.js";

// Fase 2 probe: avatar por MENSAJE (fuera del schema). Verifica:
// 1. ack avatar-ok tras enviar foto válida
// 2. B recibe la foto de A vía mensaje "avatar" (late joiner)
// 3. foto real ~30KB no mata el socket (no RangeError)
// 4. basura (MIME inválido) → sin ack y sin broadcast (reject limpio)
function makeJpegDataUrl(bytes: number): string {
  // jpeg real mínimo (1x1 px) + padding para alcanzar ~bytes
  const base = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDT/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==";
  const pad = "A".repeat(Math.max(0, bytes - base.length));
  return "data:image/jpeg;base64," + base + pad;
}

async function main() {
  const target = process.env.PROBE_URL || "ws://localhost:2567";
  const c = new Client(target);
  let avatarOk = false;
  const a = await c.joinOrCreate("world", { token: btoa("dev:avatarA") });
  a.onMessage("avatar-ok", () => { avatarOk = true; });
  await new Promise(r => setTimeout(r, 800));

  // foto real ~30KB
  const photo = makeJpegDataUrl(30_000);
  a.send("avatar", { photo });
  await new Promise(r => setTimeout(r, 1500));
  console.log("ACK avatar-ok:", avatarOk);
  console.log("socket alive:", a.connection.isOpen ?? true);

  // B entra tarde — debe recibir la foto de A por mensaje
  const b = await c.joinOrCreate("world", { token: btoa("dev:avatarB") });
  let seen = "";
  b.onMessage("avatar", (m: any) => {
    if (m.sessionId === a.sessionId && m.photo?.startsWith("data:image/")) seen = m.photo.slice(0, 30);
  });
  for (let i = 0; i < 10 && !seen; i++) await new Promise(r => setTimeout(r, 400));
  console.log("late-joiner B sees A photo:", seen ? "YES" : "NO");

  // fuzz: MIME inválido → sin broadcast
  let gotGarbage = false;
  b.onMessage("avatar", (m: any) => { if (m.photo && !m.photo.startsWith("data:image/")) gotGarbage = true; });
  a.send("avatar", { photo: "not-a-dataurl-garbage" });
  await new Promise(r => setTimeout(r, 1000));
  console.log("garbage rejected:", !gotGarbage ? "YES" : "NO");

  a.leave(); b.leave();
  const pass = avatarOk && !!seen && !gotGarbage;
  console.log(pass ? "AVATAR-PROBE-PASS" : "AVATAR-PROBE-FAIL");
  process.exit(pass ? 0 : 1);
}
main().catch(e => { console.log("PROBE-ERR", e.message); process.exit(1); });

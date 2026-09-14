import { Client } from "colyseus.js";

// Fase 5a (H13): medir el techo REAL de mensaje WS en prod con foto válida {photo}.
function makeJpegDataUrl(bytes: number): string {
  const base = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDT/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==";
  const pad = "A".repeat(Math.max(0, bytes - base.length));
  return "data:image/jpeg;base64," + base + pad;
}

async function tryAck(c: any, bytes: number): Promise<string> {
  let ok = false;
  const a = await c.joinOrCreate("world", { token: btoa("dev:pay" + bytes) });
  a.onMessage("avatar-ok", () => { ok = true; });
  await new Promise(r => setTimeout(r, 800));
  a.send("avatar", { photo: makeJpegDataUrl(bytes) });
  await new Promise(r => setTimeout(r, 1800));
  const alive = a.connection.isOpen ?? true;
  a.leave();
  await new Promise(r => setTimeout(r, 400));
  return alive ? (ok ? "ACKED" : "alive-noack") : "DEAD";
}

async function main() {
  const target = process.env.PROBE_URL || "ws://localhost:2567";
  const c0 = new Client(target);
  const sizes = [4000, 30000, 58000, 1000000, 1100000];
  const out: string[] = [];
  for (const s of sizes) out.push(s + ":" + await tryAck(c0, s));
  console.log("PAYLOAD-TICKET", out.join(" | "));
  process.exit(0);
}
main();

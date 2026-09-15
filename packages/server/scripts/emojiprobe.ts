// Fase 7 probe: emoji de A flota en B en <500ms. Criterio del plan auditor.
import fs from "node:fs";
const BASE = process.argv[2] || "http://127.0.0.1:2567";
const ADMIN = process.env.ADMIN_TOKEN || "dev-admin";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function mint(handle: string, role: string): Promise<string> {
  const r = await fetch(`${BASE.replace("ws", "http")}/api/invite`, { method: "POST", headers: { "x-admin-token": ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ handle, role, hours: 1 }) });
  return (await r.json()).token;
}
(async () => {
  const { Client } = await import("colyseus.js");
  const tokA = await mint("EmoA", "attendee");
  const tokB = await mint("EmoB", "attendee");
  const a = await (new Client(BASE.replace("http","ws"))).joinOrCreate("world", { token: tokA, handle: "EmoA", isProbe: true });
  const b = await (new Client(BASE.replace("http","ws"))).joinOrCreate("world", { token: tokB, handle: "EmoB", isProbe: true });
  await sleep(1000);
  let got: any = null;
  b.onMessage("emoji", (m: any) => { got = { m, t: Date.now() }; });
  const t0 = Date.now();
  a.send("emoji", { emoji: "😀" });
  while (!got && Date.now() - t0 < 3000) await sleep(20);
  if (!got) { console.log("F7-emoji FAIL: B nunca recibió el emoji"); process.exit(1); }
  const dt = (got as any).t - t0;
  const ok = dt < 500 && (got as any).m.emoji === "😀";
  console.log(`${ok ? "PASS" : "FAIL"} F7-emoji: A→B en ${dt}ms (<500ms)`);
  process.exit(ok ? 0 : 1);
})();

import { Client } from "colyseus.js";
async function main() {
  const url = process.env.PROBE_URL || "ws://localhost:2567";
  const gap = parseInt(process.env.STAGGER_MS || "7000");
  const n = parseInt(process.env.STAGGER_N || "4");
  const ids = new Set<string>();
  const rooms: any[] = [];
  for (let i = 0; i < n; i++) {
    const c = new Client(url);
    const r: any = await c.joinOrCreate("world", { token: btoa(`dev:stag${i}`) });
    ids.add(r.id.slice(0, 6));
    rooms.push(r);
    if (i < n - 1) await new Promise(res => setTimeout(res, gap));
  }
  console.log(`staggered ${n} x ${gap}ms -> rooms:`, [...ids].join(","), "distinct:", ids.size);
  rooms.forEach(r => r.leave());
  process.exit(ids.size === 1 ? 0 : 1);
}
main().catch(e => { console.log("ERR", e.message); process.exit(1); });

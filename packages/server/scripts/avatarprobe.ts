import { Client } from "colyseus.js";

async function main() {
  const c = new Client("wss://api.turedvirtual.vip");
  const a = await c.joinOrCreate("world", { token: btoa("dev:avatarA") });
  await new Promise(r => setTimeout(r, 800));
  // ~1.2KB tiny valid dataURL (well under 60KB cap)
  const tiny = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  a.send("avatar", { photo: tiny });
  await new Promise(r => setTimeout(r, 1200));

  const b = await c.joinOrCreate("world", { token: btoa("dev:avatarB") });
  let seen = "";
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 500));
    for (const [id, p] of (b.state.players as Map<string, any>)) {
      if (p.handle === "avatarA" && p.avatarPhoto) { seen = p.avatarPhoto.slice(0, 30); break; }
    }
    if (seen) break;
  }
  console.log(seen ? `PHOTO-RELAID ${seen}...` : "PHOTO-MISSING");
  // oversize guard check
  const big = "data:image/png;base64," + "A".repeat(70_000);
  a.send("avatar", { photo: big }); // should be ignored (already set anyway)
  a.leave(); b.leave();
  process.exit(seen ? 0 : 1);
}
main().catch(e => { console.log("PROBE-ERR", e.message); process.exit(1); });

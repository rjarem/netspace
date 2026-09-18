// HUD: minimap canvas + userlist pills with teleport-on-tap — extracted from main.ts (unchanged).
import Phaser from "phaser";
import { TILE, AUDIO_MAX_RADIUS, tileBlocked } from "./constants";
import { updateVoiceStatus } from "./voice";

type SC = any; // WorldScene (loose to avoid circular imports)


export function renderMinimap(sc: SC) {
    const mm = document.getElementById("minimap") as HTMLCanvasElement | null;
    if (!mm) return;
    const ctx = mm.getContext("2d");
    if (!ctx) return;
    const mw = mm.width, mh = mm.height;
    ctx.clearRect(0, 0, mw, mh);
    // map is mapW x mapH tiles
    const mapW = 128, mapH = 64;
    const sx = mw / mapW, sy = mh / mapH;
    // zones
    ctx.fillStyle = "#7c4dff44"; ctx.fillRect(40 * sx, 3 * sy, 24 * sx, 10 * sy);
    ctx.fillStyle = "#00bfa544"; ctx.fillRect(14 * sx, 30 * sy, 10 * sx, 8 * sy);
    ctx.fillStyle = "#ff525144"; ctx.fillRect(84 * sx, 8 * sy, 18 * sx, 12 * sy);
    for (const [id, p] of sc.players) {
      const me = id === sc.myId;
      ctx.fillStyle = me ? "#ffffff" : (p.avatarColor || "#4f7cff");
      ctx.beginPath();
      ctx.arc(p.worldX / TILE * sx, p.worldY / TILE * sy, me ? 3.2 : 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

export function renderUserList(sc: SC) {
    const ul = document.getElementById("userlist");
    if (!ul) return;
    const me = sc.players.get(sc.myId);
    // throttle DOM rebuild to 1/s
    if ((sc as any).ulLast && Date.now() - (sc as any).ulLast < 1000) return;
    (sc as any).ulLast = Date.now();
    // group players: cluster by AUDIO_MAX_RADIUS adjacency (BFS over close pairs)
    const ids = [...sc.players.keys()].filter((i) => i !== sc.myId);
    const groups: string[][] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) continue;
      const grp = [id]; seen.add(id);
      for (let k = 0; k < grp.length; k++) {
        const a = sc.players.get(grp[k])!;
        for (const b of ids) {
          if (seen.has(b)) continue;
          const bb = sc.players.get(b)!;
          if (Phaser.Math.Distance.Between(a.worldX, a.worldY, bb.worldX, bb.worldY) <= AUDIO_MAX_RADIUS * TILE) {
            grp.push(b); seen.add(b);
          }
        }
      }
      groups.push(grp);
    }
    // my group first
    const myGroup = me ? groups.find((g) => g.some((id) => {
      const p = sc.players.get(id)!;
      return Phaser.Math.Distance.Between(me.worldX, me.worldY, p.worldX, p.worldY) <= AUDIO_MAX_RADIUS * TILE;
    })) : undefined;
    groups.sort((g1, g2) => (g2 === myGroup ? 1 : 0) - (g1 === myGroup ? 1 : 0));
    // Skip rebuild when nothing user-visible changed (prevents killing in-flight taps)
    const sig = groups.map((g) => g.map((id) => id + ":" + Math.round((sc.players.get(id)?.worldX || 0) / TILE) + "," + Math.round((sc.players.get(id)?.worldY || 0) / TILE) + ":" + ((sc.players.get(id) as any)?.role || "")).join("|")).join(";") + ":exp" + (ul.dataset.exp || "0");
    if ((ul as any)._sig === sig && ul.childElementCount > 0) return;
    (ul as any)._sig = sig;
    ul.innerHTML = "";
    // render: thin by default (initials avatars); expand on hover/click
    const expanded = ul.dataset.exp === "1";
    const mk = (id: string, isMeRow: boolean) => {
      const p = sc.players.get(id)!;
      const row = document.createElement("div");
      row.title = p.handle || id;
      row.style.cssText = "display:flex;align-items:center;gap:6px;padding:4px;cursor:pointer;border-radius:8px;user-select:none;-webkit-user-select:none;touch-action:manipulation;-webkit-tap-highlight-color:transparent;";
      row.addEventListener("pointerdown", (e) => e.preventDefault());
      row.addEventListener("pointerup", (e) => { e.preventDefault(); (row as any)._jump && (row as any)._jump(); });
      // Pill button with the handle (first word, max 8 chars) — much more intuitive than initials
      const full = (p.handle || id).trim();
      const short = (full.split(/\s+/)[0] || full).slice(0, 8);
      // Fase 6: borde de color SOBRE por rol (identidad visible sin saturar)
      const ROLE_BORDER: Record<string, string> = {
        admin: "#ff5252", moderator: "#00bfa5", speaker: "#7c4dff",
        panelist: "#ffb74d", dj: "#ffb74d",
      };
      const rb = ROLE_BORDER[(p.role || "").toLowerCase()] || "";
      const dot = document.createElement("span");
      dot.style.cssText = `min-width:26px;height:26px;padding:0 8px;border-radius:13px;background:${p.avatarColor};flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;font:bold 12px system-ui;color:#fff;box-shadow:0 1px 4px #0007;white-space:nowrap;`
        + (rb ? `border:2px solid ${rb};` : "");
      dot.textContent = short;
      row.appendChild(dot);
      if (expanded) {
        const nm = document.createElement("span");
        nm.style.cssText = "font:11px system-ui;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        nm.textContent = (p.handle || id) + (isMeRow ? " (yo)" : "") + (p.mutedBy ? " 🙊" : "") + ((sc.room?.state as any)?.hands?.has?.(id) ? " ✋" : "") + (p.inStage ? " 🎤" : "") + ((sc.room?.state as any)?.megaphoneBy === id ? " 📢" : "");
        row.appendChild(nm);
      }
      // Fase 6: acciones de moderación (visibles solo si YO soy admin/mod y el
      // target no soy yo). El server re-verifica el rol del JWT de sesión —
      // ocultar el botón es solo cosmética, el enforcement es server-side.
      const myRole = (me?.role || "").toLowerCase();
      const iAmMod = myRole === "admin" || myRole === "moderator";
      const targetRole = (p.role || "").toLowerCase();
      const canAct = iAmMod && !isMeRow && full;
      if (canAct && expanded) {
        const btn = (label: string, color: string, send: () => void, title: string) => {
          const b = document.createElement("button");
          b.textContent = label; b.title = title;
          b.style.cssText = `font:11px system-ui;padding:3px 7px;border-radius:6px;border:1px solid ${color};background:transparent;color:${color};cursor:pointer;flex:0 0 auto;`;
          b.addEventListener("pointerup", (e) => { e.stopPropagation(); e.preventDefault(); send(); });
          row.appendChild(b);
        };
        // CICLO 8.2 (auditor): espejar mayTouch server-side (worldRoom RANK) —
        // ocultar lo que el server rechazaría en silencio. Solo puedo tocar a
        // quien tenga MENOR rango que yo.
        const RANK: Record<string, number> = { attendee: 0, speaker: 0, panelist: 0, dj: 0, moderator: 1, admin: 2 };
        const canTouch = (RANK[myRole] ?? 0) > (RANK[targetRole || "attendee"] ?? 0);
        const confirmThen = (what: string, danger: string, send: () => void) => {
          if (window.confirm(`${what} a ${full}?\n\n${danger}`)) send();
        };
        if (canTouch) {
          btn("🙊", "#ffb74d", () => sc.room?.send("mod:mute", { handle: full, on: !(p as any).mutedBy }), "Mute/Unmute impuesto");
        }
        if (myRole === "admin" && canTouch) {
          btn("👢", "#ff8a80", () => confirmThen("¿Expulsar (👢)", "Se le invalida su acceso actual: NO podrá re-entrar con el mismo token.", () => sc.room?.send("mod:kick", { handle: full })), "Expulsar (su token no re-entra)");
          btn("⛔", "#ff5252", () => confirmThen("¿BANear a " + full + "?", "ES PERMANENTE y no hay undo desde el cliente. Un tap accidental aquí banea a alguien inocente.", () => sc.room?.send("mod:ban", { handle: full })), "Ban permanente");
          // CICLO 4 (auditor): promote/demote en vivo — solo attendee<->moderator.
          // El server re-verifica sender.role === "admin"; el botón es cosmética.
          if (targetRole === "attendee") {
            btn("⭐", "#ffd54f", () => sc.room?.send("mod:role", { handle: full, role: "moderator" }), "Promover a moderador (vive solo esta sesión)");
          } else if (targetRole === "moderator") {
            btn("☆", "#90a4ae", () => sc.room?.send("mod:role", { handle: full, role: "attendee" }), "Degradar a usuario (vive solo esta sesión)");
          }
        }
      }
      // CICLO 5 (auditor §4): reportar — botón 🚩 para TODOS (no mods), con
      // confirmación para evitar taps accidentales. Enforcement server-side.
      if (!isMeRow && expanded) {
        const cnt = ((window as any).__grReportCount?.[full.toLowerCase()] || 0);
        if (iAmMod && cnt > 0) {
          const badge = document.createElement("span");
          badge.style.cssText = "font:bold 10px system-ui;color:#fff;background:#b62324;border-radius:8px;padding:1px 5px;flex:0 0 auto;";
          badge.textContent = "🚩" + cnt;
          badge.title = "reportes recibidos (solo mods ven esto)";
          row.appendChild(badge);
        } else if (!iAmMod) {
          const rb = document.createElement("button");
          rb.textContent = "🚩"; rb.title = "Reportar usuario (lo revisa un moderador)";
          rb.style.cssText = "font:11px system-ui;padding:3px 7px;border-radius:6px;border:1px solid #e3b341;background:transparent;color:#e3b341;cursor:pointer;flex:0 0 auto;";
          rb.addEventListener("pointerup", (e) => {
            e.stopPropagation(); e.preventDefault();
            if (confirm(`¿Reportar a ${full}?`)) sc.room?.send("report", { target: full });
          });
          row.appendChild(rb);
        }
      }
      (row as any)._jump = () => {
        try {
          // TELEPORT: move my avatar next to the target user and stay there.
          const me2 = sc.players.get(sc.myId);
          if (!me2) return;
          const gx = Math.round((p.worldX - TILE / 2) / TILE);
          const gy = Math.round((p.worldY - TILE / 2) / TILE);
          // find walkable tile adjacent to target (or the tile itself)
          const cand: Array<[number, number]> = [[gx + 1, gy], [gx - 1, gy], [gx, gy + 1], [gx, gy - 1], [gx + 1, gy + 1], [gx - 1, gy - 1], [gx + 1, gy - 1], [gx - 1, gy + 1], [gx, gy]];
          let dest: [number, number] | null = null;
          for (const c of cand) { if (!tileBlocked(c[0], c[1])) { dest = c; break; } }
          if (!dest) return;
          const dx = dest[0], dy = dest[1];
          sc.moveLock = true;
          sc.lockAt = Date.now();
          sc.movingTo = { x: dx, y: dy };
          sc.room?.send("move", { x: dx, y: dy });
          me2.worldX = dx * TILE + TILE / 2;
          me2.worldY = dy * TILE + TILE / 2;
          // Fix (Tito, 14-sep): setPosition solo movía el sprite — el label y
          // la cara quedaban en la posición anterior hasta el próximo move.
          // Mover TODOS los targets como hace animateOwnMove (sprite+label+face).
          const f = (me2.sprite as any).faceRef;
          me2.sprite.setPosition(me2.worldX, me2.worldY);
          me2.label.setPosition(me2.worldX, me2.worldY - TILE * 0.85);
          if (f) f.setPosition(me2.worldX, me2.worldY);
          sc.tweens.killTweensOf([me2.sprite, me2.label, f].filter(Boolean));
          const cam = sc.cameras.main;
          cam.stopFollow();
          cam.centerOn(me2.worldX, me2.worldY);
          cam.startFollow(me2.sprite, true, 0.1, 0.1);
          const st = document.getElementById("status");
          if (st) { st.textContent = "🚀 " + p.handle; setTimeout(() => updateVoiceStatus(sc), 1200); }
        } catch (err) { console.warn("[jump]", err); sc.pushDbg("jump-err"); }
      };
      row.onclick = (row as any)._jump;
      ul.appendChild(row);
    };
    if (me) mk(sc.myId, true);
    for (const g of groups) {
      if (expanded && groups.length > 0) {
        const sep = document.createElement("div");
        sep.style.cssText = "height:1px;background:#2a3350;margin:4px 2px;";
        ul.appendChild(sep);
      }
      for (const id of g) mk(id, false);
    }
  }


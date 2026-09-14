// Strict grid movement (T3) — extracted from main.ts (behavior unchanged).
import Phaser from "phaser";
import { TILE, tileBlocked } from "./constants";

type SC = any; // WorldScene (loose to avoid circular imports)


export function onServerPosition(sc: SC, id: string, player: any) {
    const p = sc.players.get(id);
    if (!p) return;
    const wx = player.x * TILE + TILE / 2;
    const wy = player.y * TILE + TILE / 2;
    if (id === sc.myId) {
      // Fix (Tito, 14-sep): "muro invisible" intermitente en drag. Antes self
      // NUNCA se resincronizaba (onPlayerInstanceChange saltaba a self), así
      // que la deriva local vs server se acumulaba: los drags llegaban con
      // dist>8 desde la posición REAL del server y eran rechazados en silencio
      // → sensación de muro que a veces sí, a veces no. Ahora:
      // 1) durante drag activo NO snap (el dedo es la verdad),
      // 2) fuera de drag, si el server difiere mucho, snap suave (tween corto)
      //    para re-sincronizar sin "aventón".
      const ddx = wx - p.sprite.x, ddy = wy - p.sprite.y;
      const far = Math.hypot(ddx, ddy) > TILE * 1.5;
      p.worldX = wx; p.worldY = wy;
      if ((sc as any).dragging) {
        if (!far) return; // deriva pequeña mientras arrastro: ignorar
        // deriva grande: recalcular silenciosamente (sin mover el sprite),
        // el próximo sendTile parte de la posición real del server.
        return;
      }
      if (!far) return; // coincide con lo que pinté: no tocar
      sc.tweens.killTweensOf([p.sprite, p.label, (p.sprite as any).faceRef].filter(Boolean));
      sc.tweens.add({
        targets: [p.sprite, p.label, (p.sprite as any).faceRef].filter(Boolean),
        x: wx, y: wy,
        duration: 120,
        ease: "Linear",
        onUpdate: () => {
          p.label.x = p.sprite.x; p.label.y = p.sprite.y - TILE * 0.85;
          const f2 = (p.sprite as any).faceRef;
          if (f2) { f2.x = p.sprite.x; f2.y = p.sprite.y; }
        },
      });
      if (
        sc.movingTo &&
        Math.round(player.x) === sc.movingTo.x &&
        Math.round(player.y) === sc.movingTo.y
      ) {
        sc.moveLock = false;
        sc.movingTo = null;
      }
    } else {
      p.worldX = wx; p.worldY = wy;
      sc.tweens.add({
        targets: [p.sprite, p.label, (p.sprite as any).faceRef].filter(Boolean),
        x: wx, y: wy,
        duration: 110,
        onUpdate: () => { p.label.x = p.sprite.x; p.label.y = p.sprite.y - TILE * 0.85; },
      });
    }
  }

export function tick(sc: SC) {
    if (!sc.room) return;
    if (sc.moveLock) {
      const meS = sc.players.get(sc.myId);
      if (meS && !sc.tweens.isTweening(meS.sprite)) {
        // tween gone (rejected move / edge case): re-sync from stored tile and unlock
        meS.sprite.x = meS.worldX; meS.sprite.y = meS.worldY;
        sc.moveLock = false; sc.movingTo = null;
      }
    }
    if (sc.moveLock) {
      // Hard watchdog: never allow a stuck lock to freeze navigation.
      if (Date.now() - (sc.lockAt || 0) > 450) { sc.moveLock = false; sc.movingTo = null; }
      else return;
    }
    const me = sc.players.get(sc.myId);
    if (!me) return;

    // Current tile = integer tile the server last confirmed for me.
    const cur = {
      x: Math.round((me.worldX - TILE / 2) / TILE),
      y: Math.round((me.worldY - TILE / 2) / TILE),
    };

    let dir: { dx: number; dy: number } | null = null;
    // v2: keyboard arrows REMOVED — movement is click-to-move + drag only.
    if (!sc.target) return;

    if (sc.target) {
      const dx = Math.sign(sc.target.x - cur.x);
      const dy = Math.sign(sc.target.y - cur.y);
      if (dx !== 0 || dy !== 0) {
        if (dx !== 0 && dy !== 0 && !tileBlocked(cur.x + dx, cur.y + dy)) {
          // Prefer diagonal steps: walks a straight line toward the click point.
          dir = { dx, dy };
        } else if (dx !== 0 && !tileBlocked(cur.x + dx, cur.y)) {
          dir = { dx, dy: 0 };
        } else if (dy !== 0 && !tileBlocked(cur.x, cur.y + dy)) {
          dir = { dx: 0, dy };
        } else {
          sc.target = null; // fully blocked; give up on this target
        }
      } else {
        sc.target = null; // arrived
      }
    } else return;

    const nx = cur.x + dir!.dx, ny = cur.y + dir!.dy;
    if (tileBlocked(nx, ny)) return; // client-side pre-check; server still validates

    sc.moveLock = true;
    sc.lockAt = Date.now();
    sc.movingTo = { x: nx, y: ny };
    sc.room.send("move", { x: nx, y: ny });
    // Colyseus does NOT echo own-schema changes to the sender, so the server
    // onChange will NOT fire for us. Animate optimistically tile→tile and
    // unlock when the animation completes. If the server rejects the move
    // (wall/zone), our stored tile stays put and the next move re-syncs.
    animateOwnMove(sc, nx, ny);
  }

export function animateOwnMove(sc: SC, tx: number, ty: number) {
    const me = sc.players.get(sc.myId);
    if (!me) { sc.moveLock = false; return; }
    const wx = tx * TILE + TILE / 2;
    const wy = ty * TILE + TILE / 2;
    sc.tweens.add({
      targets: [me.sprite, me.label, (me.sprite as any).faceRef].filter(Boolean),
      x: wx, y: wy,
      duration: 120,
      ease: "Linear",
      onUpdate: () => {
        me.label.x = me.sprite.x; me.label.y = me.sprite.y - TILE * 0.85;
        const f = (me.sprite as any).faceRef;
        if (f) { f.x = me.sprite.x; f.y = me.sprite.y; }},
      onComplete: () => {
        me.worldX = wx; me.worldY = wy;
        sc.moveLock = false;
        sc.movingTo = null;
      },
    });
  }

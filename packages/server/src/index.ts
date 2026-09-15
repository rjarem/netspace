// NetSpace server entry — Colyseus + express
import http from "http";
import express from "express";
import colyseus from "colyseus";
const { Server } = colyseus;
import { WebSocketTransport } from "@colyseus/ws-transport";
import { WorldRoom } from "./worldRoom.js";
import { inviteRouter } from "./invite.js";

const PORT = parseInt(process.env.PORT || "2567");

const app = express();
app.get("/api/health", (_req, res) => res.json({
  ok: true,
  room: "netspace",
  // Fase 5b (gate-auth): expone el modo auth para que el gate sepa qué esperar.
  // devAuth=true => dev-token sin JWT entra (solo con DEV_NO_AUTH=1).
  devAuth: process.env.DEV_NO_AUTH === "1",
}));
// Fase 3 debugging (auditor-prescrito): los clientes headless ?probe= reportan
// cada paso de connect() aquí; el log cae a stdout del server (gr-server.log).
app.get("/api/probelog", (req, res) => {
  console.log("[probelog] " + (req.query.m || "").toString().slice(0, 300));
  res.json({ ok: true });
});
app.use(inviteRouter());

const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
    // Colyseus default is 4KB — any avatar photo (>4KB dataURL) killed the
    // websocket mid-join, dropping the client into a fresh room (everyone
    // isolated). 1MB comfortably fits 256px jpeg (~30KB) + state patches.
    maxPayload: 1024 * 1024,
  }),
});
// Fase 1.1: matchmake determinista — UNA sala "world" por server-instance.
// autoDispose OFF: la sala vive mientras viva el server; un blip de socket o
// el último cliente yéndose NUNCA dispara una sala nueva (causa del split).
gameServer.define("world", WorldRoom, { autoDispose: false });
gameServer.listen(PORT).then(async () => {
  console.log(`[netspace] listening on :${PORT}`);
  // Fase 1.1: crear la sala nombrada al boot (criterio: creada exactamente una vez).
  try {
    const colyseusMod: any = await import("colyseus");
    const mm = colyseusMod.matchMaker || colyseusMod.default?.matchMaker;
    await mm.createRoom("world", {});
    console.log("world named room created");
  } catch (e) {
    console.error("world named room create failed:", (e as Error).message);
  }
});
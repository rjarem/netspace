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
app.get("/api/health", (_req, res) => res.json({ ok: true, room: "netspace" }));
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
gameServer.define("world", WorldRoom);

gameServer.listen(PORT).then(() => console.log(`[netspace] listening on :${PORT}`));
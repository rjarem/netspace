// NetSpace server entry — Colyseus + express
import http from "http";
import express from "express";
import colyseus from "colyseus";
const { Server } = colyseus;
import { WebSocketTransport } from "@colyseus/ws-transport";
import { WorldRoom, worldRooms } from "./worldRoom.js";
import { inviteRouter } from "./invite.js";
const PORT = parseInt(process.env.PORT || "2567");
const app = express();
// Fase 8: exponer el roomId de la sala nombrada — el cliente entra por ID
// (matchmake determinista REAL; mata la carrera A/B del gate C). CORS abierto:
// el fetch del cliente (play.→api.) es cross-origin y SIN esta cabecera el
// navegador lo bloquea y cae al fallback racy.
app.get("/api/health", (_req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.json({
        ok: true,
        // Auditor 16-sep: alinear con la sala real (LIVEKIT_ROOM) — el valor
        // hardcodeado "netspace" confundía la verificación de salas por entorno.
        room: process.env.LIVEKIT_ROOM || "netspace-world",
        worldRoomId: [...worldRooms][0]?.roomId || null,
        // Fase 5b (gate-auth): expone el modo auth para que el gate sepa qué esperar.
        // devAuth=true => dev-token sin JWT entra (solo con DEV_NO_AUTH=1).
        devAuth: process.env.DEV_NO_AUTH === "1",
    });
});
// Fase 3 debugging (auditor-prescrito): los clientes headless ?probe= reportan
// cada paso de connect() aquí; el log cae a stdout del server (gr-server.log).
app.get("/api/probelog", (req, res) => {
    console.log("[probelog] " + (req.query.m || "").toString().slice(0, 300));
    res.json({ ok: true });
});
app.use(inviteRouter());
// Fase 8 (auditor): POST /api/mod — moderar SIN estar en la sala. Solo
// x-admin-token. Acciones: mute|unmute|kick|ban|unban|broadcast|grant|revoke.
app.post("/api/mod", (req, res) => {
    const adminToken = process.env.ADMIN_TOKEN || "";
    if (!adminToken || req.headers["x-admin-token"] !== adminToken) {
        return res.status(401).json({ error: "unauthorized" });
    }
    const { action, handle, on, text } = req.body || {};
    if (!action)
        return res.status(400).json({ error: "missing action" });
    const room = [...worldRooms][0];
    if (!room)
        return res.status(404).json({ error: "no hay sala activa" });
    room.adminApi(String(action), String(handle || ""), on !== false, String(text || ""))
        .then((r) => res.json({ ok: true, result: r }))
        .catch((e) => res.status(500).json({ error: String(e?.message || e) }));
});
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
        const colyseusMod = await import("colyseus");
        const mm = colyseusMod.matchMaker || colyseusMod.default?.matchMaker;
        await mm.createRoom("world", {});
        console.log("world named room created");
    }
    catch (e) {
        console.error("world named room create failed:", e.message);
    }
});

// LiveKit token minting + Admin API helpers (Fase 6, hallazgos H2/H4 auditor)
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
// Fase 5b / H17 (auditor): sala LiveKit por entorno — prod y local NUNCA
// comparten sala (un probe podía oír la voz de un usuario real).
export const ROOM = process.env.LIVEKIT_ROOM || "netspace-world";
export async function mintLiveKitToken(opts, _host, apiKey, apiSecret) {
    if (!apiKey || !apiSecret)
        return ""; // voice disabled without config
    const at = new AccessToken(apiKey, apiSecret, {
        identity: opts.identity,
        name: opts.name,
    });
    at.addGrant({
        room: ROOM,
        roomJoin: true,
        canPublish: opts.canPublish,
        canSubscribe: opts.canSubscribe,
        canPublishData: true,
    });
    return (await at.toJwt());
}
// H2 (auditor Fase 6): mute REAL de la pista de audio publicada del
// participante + revocación del permiso de publicación mientras dure el mute
// (sin esto, el muteado podía re-publicar desde su actionbar). Devuelve
// {tracks: pistas silenciadas, perm: permiso actualizado} — observable por
// Admin API para el probe.
export async function muteParticipantAudio(apiKey, apiSecret, host, identity, muted) {
    if (!apiKey || !apiSecret)
        return { tracks: 0, perm: false };
    const svc = new RoomServiceClient(host, apiKey, apiSecret);
    try {
        const parts = await svc.listParticipants(ROOM);
        const p = parts.find((x) => x.identity === identity);
        let n = 0;
        if (p) {
            for (const pub of (p.trackPublications || p.tracks || [])) {
                if (pub.mimeType?.startsWith("audio") || pub.source === "MICROPHONE" || pub.type === "AUDIO") {
                    await svc.mutePublishedTrack(ROOM, identity, pub.sid, muted);
                    n++;
                }
            }
        }
        // revocar/restore permiso de publicación mientras dure el mute
        // SDK 2.19: updateParticipant(room, identity, metadata?, permission?, name?)
        // — el permiso va 4º; en el 3º se ignoraba silenciosamente (bug H2a).
        await svc.updateParticipant(ROOM, identity, p?.metadata ?? undefined, {
            canPublish: !muted, canPublishData: !muted,
        });
        return { tracks: n, perm: !muted };
    }
    catch (e) {
        console.warn("[livekit-admin] muteParticipantAudio:", e.message);
        return { tracks: 0, perm: false };
    }
}
// H4 (auditor Fase 6): expulsado/baneado sale TAMBIÉN de la sala de voz —
// su token vive ~6h y sin esto seguiría oyendo (y hablando) el evento.
export async function removeParticipantVoice(apiKey, apiSecret, host, identity) {
    if (!apiKey || !apiSecret)
        return false;
    const svc = new RoomServiceClient(host, apiKey, apiSecret);
    try {
        await svc.removeParticipant(ROOM, identity);
        return true;
    }
    catch (e) {
        console.warn("[livekit-admin] removeParticipantVoice:", e.message);
        return false;
    }
}

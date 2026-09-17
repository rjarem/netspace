// LiveKit token minting + Admin API helpers (Fase 6, hallazgos H2/H4 auditor)
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

// Fase 5b / H17 (auditor): sala LiveKit por entorno — prod y local NUNCA
// comparten sala (un probe podía oír la voz de un usuario real).
export const ROOM = process.env.LIVEKIT_ROOM || "netspace-world";

export async function mintLiveKitToken(
  opts: { identity: string; name: string; canPublish: boolean; canSubscribe: boolean },
  _host: string,
  apiKey: string,
  apiSecret: string,
): Promise<string> {
  if (!apiKey || !apiSecret) return ""; // voice disabled without config
  const at = new AccessToken(apiKey, apiSecret, {
    identity: opts.identity,
    name: opts.name,
    // CICLO 7.2 (auditor-firmado): TTL explícito — sin esto el token vive el
    // default (~6h) y un usuario en evento largo pierde la capacidad de
    // RECONEXIÓN (la sesión viva no se corta; el token solo se valida al
    // conectar). El intervalo de worldRoom re-mintea cada 4h.
    ttl: Number(process.env.LIVEKIT_TOKEN_TTL ?? 86400), // 24h default; gates acortan
  });
  at.addGrant({
    room: ROOM,
    roomJoin: true,
    canPublish: opts.canPublish,
    canSubscribe: opts.canSubscribe,
    canPublishData: true,
  });
  return (await at.toJwt()) as string;
}

// H2 (auditor Fase 6): mute REAL de la pista de audio publicada del
// participante + revocación del permiso de publicación mientras dure el mute
// (sin esto, el muteado podía re-publicar desde su actionbar). Devuelve
// {tracks: pistas silenciadas, perm: permiso actualizado} — observable por
// Admin API para el probe.
export async function muteParticipantAudio(
  apiKey: string,
  apiSecret: string,
  host: string,
  identity: string,
  muted: boolean,
): Promise<{ tracks: number; perm: boolean }> {
  if (!apiKey || !apiSecret) return { tracks: 0, perm: false };
  const svc = new RoomServiceClient(host, apiKey, apiSecret);
  try {
    const parts = await svc.listParticipants(ROOM);
    const p = parts.find((x: any) => x.identity === identity);
    let n = 0;
    if (p) {
      for (const pub of ((p as any).trackPublications || (p as any).tracks || []) as any[]) {
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
    } as any);
    return { tracks: n, perm: !muted };
  } catch (e) {
    console.warn("[livekit-admin] muteParticipantAudio:", (e as Error).message);
    return { tracks: 0, perm: false };
  }
}

// H4 (auditor Fase 6): expulsado/baneado sale TAMBIÉN de la sala de voz —
// su token vive ~6h y sin esto seguiría oyendo (y hablando) el evento.
export async function removeParticipantVoice(
  apiKey: string,
  apiSecret: string,
  host: string,
  identity: string,
): Promise<boolean> {
  if (!apiKey || !apiSecret) return false;
  const svc = new RoomServiceClient(host, apiKey, apiSecret);
  try {
    await svc.removeParticipant(ROOM, identity);
    return true;
  } catch (e) {
    console.warn("[livekit-admin] removeParticipantVoice:", (e as Error).message);
    return false;
  }
}

// LiveKit token minting
import { AccessToken } from "livekit-server-sdk";

// Fase 5b / H17 (auditor): sala LiveKit por entorno — prod y local NUNCA
// comparten sala (un probe podía oír la voz de un usuario real).
const ROOM = process.env.LIVEKIT_ROOM || "netspace-world";

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
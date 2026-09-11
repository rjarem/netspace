// LiveKit token minting
import { AccessToken } from "livekit-server-sdk";

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
    room: "netspace-world",
    canPublish: opts.canPublish,
    canSubscribe: opts.canSubscribe,
    canPublishData: true,
  });
  return (await at.toJwt()) as string;
}
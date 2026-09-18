/**
 * The Liquid Auth signaling service the demo pair meets on. Point it at
 * your own deployment via `VITE_LIQUID_AUTH_URL`; the public debug
 * instance is the zero-config default.
 */
export const SIGNAL_URL: string =
  ((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_LIQUID_AUTH_URL as
    | string
    | undefined) ?? "https://debug.liquidauth.com";

/**
 * The ICE servers the WebRTC peer negotiates through: Nodely's public
 * STUN + TURN (the credentials liquid-auth publishes for its demos).
 * Without a TURN relay, cross-network negotiation (browser ↔ phone over
 * the public signaling server) regularly stalls at ICE. The wallet
 * example passes the same list on its side.
 */
export const ICE_SERVERS: RTCIceServer[] = [
  {
    urls: ["stun:geo.turn.algonode.xyz:80", "stun:global.turn.nodely.io:443"],
  },
  {
    urls: [
      "turn:geo.turn.algonode.xyz:80?transport=tcp",
      "turns:global.turn.nodely.io:443?transport=tcp",
    ],
    username: "liquid-auth",
    credential: "sqmcP4MiTKMT4TGEDSk9jgHY",
  },
];

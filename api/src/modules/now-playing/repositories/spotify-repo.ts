import { createHash } from "node:crypto";
import { env } from "../../../lib/env";
import { SpotifyPlayerResponse, NowPlayingResult } from "../dtos/now-playing-response-dto";
import { createCache } from "../../../lib/cache";
import { Logger } from "../../../lib/logger";
import { createUpstreamGuard, requestJson, UpstreamError } from "../../../lib/upstream";
import { SpotifyTokenResponse, saveSpotifyRefreshToken } from "../../../lib/spotify-tokens";

let accessToken: string | null = null;
let tokenExpiresAt = 0;
let fingerprint = "";
const nowPlayingCache = createCache<NowPlayingResult | null>(10_000, { maxEntries: 1 });
let guard = createUpstreamGuard("spotify-player", Logger);

function credentialsFingerprint() {
  return createHash("sha256").update(JSON.stringify([
    env.SPOTIFY_CLIENT_ID, env.SPOTIFY_CLIENT_SECRET, env.SPOTIFY_REFRESH_TOKEN,
  ])).digest("hex");
}

async function refreshAccessToken() {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_REFRESH_TOKEN) throw new UpstreamError("http_error", 403);
  const previousToken = env.SPOTIFY_REFRESH_TOKEN;
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (env.SPOTIFY_CLIENT_SECRET) {
    headers.Authorization = `Basic ${Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString("base64")}`;
  }
  const response = await requestJson("https://accounts.spotify.com/api/token", {
    method: "POST", headers,
    body: new URLSearchParams({
      grant_type: "refresh_token", client_id: env.SPOTIFY_CLIENT_ID,
      refresh_token: env.SPOTIFY_REFRESH_TOKEN,
    }),
  });
  const parsed = SpotifyTokenResponse.safeParse(response.data);
  if (!parsed.success) throw new UpstreamError("invalid_response", response.status);
  if (env.SPOTIFY_REFRESH_TOKEN !== previousToken) throw new UpstreamError("invalid_response");
  if (parsed.data.refresh_token && parsed.data.refresh_token !== env.SPOTIFY_REFRESH_TOKEN) {
    await saveSpotifyRefreshToken(parsed.data.refresh_token, previousToken);
    fingerprint = credentialsFingerprint();
  }
  accessToken = parsed.data.access_token;
  tokenExpiresAt = Date.now() + Math.max(1, parsed.data.expires_in - 60) * 1000;
}

export async function fetchCurrentlyPlaying(): Promise<NowPlayingResult | null> {
  const current = credentialsFingerprint();
  if (current !== fingerprint) {
    fingerprint = current;
    accessToken = null;
    nowPlayingCache.clear();
    guard = createUpstreamGuard("spotify-player", Logger);
  }
  return nowPlayingCache.fetch("current", () => guard(async () => {
    if (!accessToken || Date.now() >= tokenExpiresAt) await refreshAccessToken();
    const requestedCredentials = credentialsFingerprint();
    const response = await requestJson("https://api.spotify.com/v1/me/player/currently-playing", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (credentialsFingerprint() !== requestedCredentials) throw new UpstreamError("invalid_response");
    if (response.status === 204) return null;
    const parsed = SpotifyPlayerResponse.safeParse(response.data);
    if (!parsed.success) throw new UpstreamError("invalid_response", response.status);
    const item = parsed.data.item;
    return NowPlayingResult.parse({
      track: item?.name ?? null,
      artist: item?.artists?.map((a) => a.name).join(", ") ?? null,
      albumArt: item?.album?.images?.[0]?.url ?? null,
      url: item?.external_urls?.spotify ?? null,
      isPlaying: !!parsed.data.is_playing,
    });
  }));
}

import { createHash } from "node:crypto";
import { SpotifyPlayerResponse, NowPlayingResult } from "../dtos/now-playing-response-dto";
import { createCache } from "../../../lib/cache";
import { Logger } from "../../../lib/logger";
import { createUpstreamGuard, requestJson, UpstreamError } from "../../../lib/upstream";
import { SpotifyTokenResponse, saveSpotifyRefreshToken, spotifyCredentials, SpotifyUsername } from "../../../lib/spotify-tokens";

function createPlayer(username: SpotifyUsername) {
  let accessToken: string | null = null;
  let tokenExpiresAt = 0;
  let fingerprint = "";
  const nowPlayingCache = createCache<NowPlayingResult | null>(10_000, { maxEntries: 1 });
  let guard = createUpstreamGuard("spotify-player", Logger);

  function credentialsFingerprint() {
    return createHash("sha256").update(JSON.stringify(spotifyCredentials(username))).digest("hex");
  }

  async function refreshAccessToken() {
    const credentials = spotifyCredentials(username);
    if (!credentials.clientId || !credentials.refreshToken) throw new UpstreamError("http_error", 403);
    const previousToken = credentials.refreshToken;
    const requestedCredentials = credentialsFingerprint();
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
    if (credentials.clientSecret) {
      headers.Authorization = `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")}`;
    }
    const response = await requestJson("https://accounts.spotify.com/api/token", {
      method: "POST", headers,
      body: new URLSearchParams({
        grant_type: "refresh_token", client_id: credentials.clientId,
        refresh_token: credentials.refreshToken,
      }),
    });
    const parsed = SpotifyTokenResponse.safeParse(response.data);
    if (!parsed.success) throw new UpstreamError("invalid_response", response.status);
    if (credentialsFingerprint() !== requestedCredentials) throw new UpstreamError("invalid_response");
    if (parsed.data.refresh_token && parsed.data.refresh_token !== spotifyCredentials(username).refreshToken) {
      await saveSpotifyRefreshToken(username, parsed.data.refresh_token, previousToken);
      fingerprint = credentialsFingerprint();
    }
    accessToken = parsed.data.access_token;
    tokenExpiresAt = Date.now() + Math.max(1, parsed.data.expires_in - 60) * 1000;
  }

  return async function fetchCurrentlyPlaying(): Promise<NowPlayingResult | null> {
    const current = credentialsFingerprint();
    if (current !== fingerprint) {
      fingerprint = current;
      accessToken = null;
      nowPlayingCache.clear();
      guard = createUpstreamGuard("spotify-player", Logger);
    }
    return nowPlayingCache.fetch(username, () => guard(async () => {
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
}

const players = new Map<SpotifyUsername, ReturnType<typeof createPlayer>>();

export function fetchCurrentlyPlaying(username: SpotifyUsername): Promise<NowPlayingResult | null> {
  let player = players.get(username);
  if (!player) {
    player = createPlayer(username);
    players.set(username, player);
  }
  return player();
}

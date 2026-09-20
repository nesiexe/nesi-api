import { env } from "../../../lib/env";
import { SpotifyPlayerResponse, NowPlayingResult } from "../dtos/now-playing-response-dto";
import { createCache } from "../../../lib/cache";
import { z } from "zod";
import { Logger } from "../../../lib/logger";

let accessToken: string | null = null;
let tokenExpiresAt = 0;
let refreshPromise: Promise<void> | null = null;

const nowPlayingCache = createCache<NowPlayingResult | null>(10_000);

async function refreshAccessToken() {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET || !env.SPOTIFY_REFRESH_TOKEN) {
    Logger.warn("Spotify credentials are not set. Please set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REFRESH_TOKEN in your environment variables.");
    throw new Error("Server Error");
  }

  const creds = Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString("base64");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: env.SPOTIFY_REFRESH_TOKEN,
    }),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const raw = (await res.json()) as unknown;
  const tokenSchema = z.object({ access_token: z.string(), expires_in: z.union([z.number(), z.string()]).optional() });
  const tokenParsed = tokenSchema.safeParse(raw);
  if (!tokenParsed.success) throw new Error("Invalid token response from Spotify");
  const tokenData = tokenParsed.data;
  accessToken = tokenData.access_token;
  tokenExpiresAt = Date.now() + (Number(tokenData.expires_in ?? 3600) - 60) * 1000;
}

export async function fetchCurrentlyPlaying(): Promise<NowPlayingResult | null> {
  return nowPlayingCache.fetch("current", async () => {
    if (!accessToken || Date.now() >= tokenExpiresAt) {
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
      }
      await refreshPromise;
    }

    Logger.debug(`fetching spotify api!`)
    const res = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 204 || res.status >= 400) {
      return null;
    }

    const rawPlayer = (await res.json()) as unknown;
    const parsed = SpotifyPlayerResponse.safeParse(rawPlayer);
    if (!parsed.success) {
      return null;
    }

    const item = parsed.data.item;
    return NowPlayingResult.parse({
      track: item?.name ?? null,
      artist: item?.artists?.map((a) => a.name).join(", ") ?? null,
      albumArt: item?.album?.images?.[0]?.url ?? null,
      url: item?.external_urls?.spotify ?? null,
      isPlaying: !!parsed.data.is_playing,
    });
  });
}

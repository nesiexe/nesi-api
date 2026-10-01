import { z } from "zod";
import { env } from "./env";
import { createSpotifyTokenStore, SpotifySecret } from "./spotify-token-store";

export const SpotifyTokenResponse = z.object({
  access_token: SpotifySecret,
  refresh_token: SpotifySecret.optional(),
  expires_in: z.number().int().positive(),
});

const store = createSpotifyTokenStore(env.SPOTIFY_TOKEN_FILE ?? ".secrets/spotify-refresh-token");
let writes: Promise<void> = Promise.resolve();

export async function initializeSpotifyToken() {
  const token = await store.load();
  if (token) env.SPOTIFY_REFRESH_TOKEN = token;
}

export function saveSpotifyRefreshToken(token: string, expectedToken?: string): Promise<void> {
  const write = writes.then(async () => {
    // A response from an older account must not overwrite a fresh authorization.
    if (expectedToken !== undefined && env.SPOTIFY_REFRESH_TOKEN !== expectedToken) {
      throw new Error("Spotify authorization changed during token refresh");
    }
    await store.save(token);
    env.SPOTIFY_REFRESH_TOKEN = token;
  });
  writes = write.catch(() => undefined);
  return write;
}

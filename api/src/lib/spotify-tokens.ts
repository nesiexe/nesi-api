import { z } from "zod";
import { env } from "./env";
import { createSpotifyTokenStore, SpotifySecret } from "./spotify-token-store";

export const SpotifyTokenResponse = z.object({
  access_token: SpotifySecret,
  refresh_token: SpotifySecret.optional(),
  expires_in: z.number().int().positive(),
});

export const SpotifyUsername = z.enum(["nesi", "frog"]);
export type SpotifyUsername = z.infer<typeof SpotifyUsername>;

const prefixes = { nesi: "NESI", frog: "FROG" } as const;

export function spotifyCredentials(username: SpotifyUsername) {
  const prefix = prefixes[username];
  return {
    clientId: env[`${prefix}_SPOTIFY_CLIENT_ID`],
    clientSecret: env[`${prefix}_SPOTIFY_CLIENT_SECRET`],
    refreshToken: env[`${prefix}_SPOTIFY_REFRESH_TOKEN`],
  };
}

const accounts = new Map<SpotifyUsername, {
  store: ReturnType<typeof createSpotifyTokenStore>;
  writes: Promise<void>;
}>();

function account(username: SpotifyUsername) {
  let value = accounts.get(username);
  if (!value) {
    value = {
      store: createSpotifyTokenStore(`${env.SPOTIFY_TOKEN_FILE ?? ".secrets/spotify-refresh-token"}.${username}`),
      writes: Promise.resolve(),
    };
    accounts.set(username, value);
  }
  return value;
}

export async function initializeSpotifyToken() {
  for (const username of SpotifyUsername.options) {
    const token = await account(username).store.load();
    if (token) env[`${prefixes[username]}_SPOTIFY_REFRESH_TOKEN`] = token;
  }
}

export function saveSpotifyRefreshToken(username: SpotifyUsername, token: string, expectedToken?: string): Promise<void> {
  const selected = account(username);
  const write = selected.writes.then(async () => {
    // A response from an older account must not overwrite a fresh authorization.
    if (expectedToken !== undefined && spotifyCredentials(username).refreshToken !== expectedToken) {
      throw new Error("Spotify authorization changed during token refresh");
    }
    await selected.store.save(token);
    env[`${prefixes[username]}_SPOTIFY_REFRESH_TOKEN`] = token;
  });
  selected.writes = write.catch(() => undefined);
  return write;
}

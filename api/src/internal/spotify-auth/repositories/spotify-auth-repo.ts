import { env } from "../../../lib/env";
import { Logger } from "../../../lib/logger";
import { SpotifyTokenResponse, saveSpotifyRefreshToken } from "../../../lib/spotify-tokens";
import { createUpstreamGuard, requestJson, UpstreamError } from "../../../lib/upstream";

const SPOTIFY_SCOPES = "user-read-currently-playing user-read-playback-state";
const guard = createUpstreamGuard("spotify-authorization", Logger);

export function buildSpotifyAuthUrl(state: string, challenge: string): string {
  if (!env.SPOTIFY_CLIENT_ID) throw new Error("SPOTIFY_CLIENT_ID is not set");
  const params = new URLSearchParams({
    client_id: env.SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: env.SPOTIFY_REDIRECT_URI,
    scope: SPOTIFY_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function exchangeCodeForRefreshToken(code: string, verifier: string): Promise<string> {
  if (!env.SPOTIFY_CLIENT_ID) throw new Error("Spotify authorization is not configured");
  const refreshToken = await guard(async () => {
    const response = await requestJson("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.SPOTIFY_CLIENT_ID!,
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: env.SPOTIFY_REDIRECT_URI,
      }),
    });
    const parsed = SpotifyTokenResponse.safeParse(response.data);
    if (!parsed.success || !parsed.data.refresh_token) throw new UpstreamError("invalid_response", response.status);
    return parsed.data.refresh_token;
  });
  await saveSpotifyRefreshToken(refreshToken);
  return refreshToken;
}

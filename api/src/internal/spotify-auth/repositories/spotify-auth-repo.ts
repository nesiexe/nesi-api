import { env } from "../../../lib/env";
import { Logger } from "../../../lib/logger";
import { SpotifyTokenResponse, saveSpotifyRefreshToken, spotifyCredentials, SpotifyUsername } from "../../../lib/spotify-tokens";
import { createUpstreamGuard, requestJson, UpstreamError } from "../../../lib/upstream";

const SPOTIFY_SCOPES = "user-read-currently-playing user-read-playback-state";
const guard = createUpstreamGuard("spotify-authorization", Logger);

export function buildSpotifyAuthUrl(state: string, challenge: string, username: SpotifyUsername = "nesi"): string {
  const { clientId } = spotifyCredentials(username);
  if (!clientId) throw new Error("Spotify client ID is not set");
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: env.SPOTIFY_REDIRECT_URI,
    scope: SPOTIFY_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function exchangeCodeForRefreshToken(code: string, verifier: string, username: SpotifyUsername = "nesi"): Promise<string> {
  const { clientId } = spotifyCredentials(username);
  if (!clientId) throw new Error("Spotify authorization is not configured");
  const refreshToken = await guard(async () => {
    const response = await requestJson("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
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
  await saveSpotifyRefreshToken(username, refreshToken);
  return refreshToken;
}

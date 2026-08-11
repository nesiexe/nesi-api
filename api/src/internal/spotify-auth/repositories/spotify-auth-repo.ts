import { readFile, writeFile } from "fs/promises";
import path from "path";
import { env, reloadEnv } from "../../../lib/env";
import { Logger } from "../../../lib/logger";
import { SpotifyTokenResponse } from "../dtos/spotify-auth-dto";

const SPOTIFY_SCOPES = "user-read-currently-playing user-read-playback-state";

export function buildSpotifyAuthUrl(): string {
  if (!env.SPOTIFY_CLIENT_ID) {
    throw new Error("SPOTIFY_CLIENT_ID is not set");
  }

  const params = new URLSearchParams({
    client_id: env.SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: env.SPOTIFY_REDIRECT_URI,
    scope: SPOTIFY_SCOPES,
  });

  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function exchangeCodeForRefreshToken(code: string): Promise<string> {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
    throw new Error("Spotify credentials are not set");
  }

  const creds = Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString("base64");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: env.SPOTIFY_REDIRECT_URI,
    }),
  });

  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);

  const raw = (await res.json()) as unknown;
  const parsed = SpotifyTokenResponse.safeParse(raw);
  if (!parsed.success) throw new Error("Invalid token response from Spotify");

  const refreshToken = parsed.data.refresh_token;
  if (!refreshToken) throw new Error("No refresh token returned from Spotify");

  await saveRefreshTokenToEnv(refreshToken);
  return refreshToken;
}

export async function saveRefreshTokenToEnv(refreshToken: string): Promise<void> {
  const envPath = path.resolve(process.cwd(), ".env");
  const line = `SPOTIFY_REFRESH_TOKEN=${refreshToken}`;

  const contents = await readFile(envPath, "utf8");

  const updated = contents.includes("SPOTIFY_REFRESH_TOKEN=")
    ? contents
        .split("\n")
        .map((l) => (l.startsWith("SPOTIFY_REFRESH_TOKEN=") ? line : l))
        .join("\n")
    : `${contents.trimEnd()}\n${line}\n`;

  await writeFile(envPath, updated);
  reloadEnv();
  Logger.info("Saved new SPOTIFY_REFRESH_TOKEN to .env");
}

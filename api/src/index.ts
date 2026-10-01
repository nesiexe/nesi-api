import { Logger } from "./lib/logger";
import { env } from "./lib/env";
import { buildApp, buildPrivateApp } from "./app";

import { initializeSpotifyToken } from "./lib/spotify-tokens";

async function main() {
  await initializeSpotifyToken();
  const app = await buildApp();
  const privateApp = env.SPOTIFY_AUTH_PASSWORD ? await buildPrivateApp() : undefined;

  const shutdown = async () => {
    await Promise.all([app.close(), privateApp?.close()]);
  };
  process.once("SIGINT", () => { void shutdown(); });
  process.once("SIGTERM", () => { void shutdown(); });

  try {
    await app.listen({ port: env.SERVER_PORT, host: env.SERVER_HOST });
    if (privateApp) {
      await privateApp.listen({ port: env.PRIVATE_APP_PORT, host: env.PRIVATE_APP_HOST });
      Logger.info("Spotify authorization server enabled");
    }
  } catch (error) {
    await shutdown();
    throw error;
  }
}

main().catch(() => {
  Logger.error("API startup failed; check server and proxy configuration");
  process.exitCode = 1;
});

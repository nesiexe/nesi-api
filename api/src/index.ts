import Fastify from "fastify";
import { Logger } from "./lib/logger";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import cors from "@fastify/cors";
import { env } from "./lib/env";
import { errorsPlugin } from "./lib/errors";
import nowPlayingModule from "./modules/now-playing";
import barqStatusModule from "./modules/barq-status";
import barqUserCountModule from "./modules/barq-user-count";
import spotifyAuthModule from "./internal/spotify-auth";

const app = Fastify({ logger: true, trustProxy: true });
const privateApp = Fastify({ logger: true, trustProxy: true, ignoreTrailingSlash: true });

const corsOrigins = env.CORS_ORIGINS
  ? env.CORS_ORIGINS.split(",").map((s) => s.trim())
  : [];

app.register(cors, { origin: corsOrigins.length > 0 ? corsOrigins : false });

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

app.register(errorsPlugin);
app.register(nowPlayingModule);
app.register(barqStatusModule);
app.register(barqUserCountModule);

privateApp.setValidatorCompiler(validatorCompiler);
privateApp.setSerializerCompiler(serializerCompiler);

privateApp.register(errorsPlugin);
privateApp.register(spotifyAuthModule);

const start = async () => {
  try {
    await app.listen({ port: env.SERVER_PORT, host: env.SERVER_HOST });
    Logger.info(`Server listening on port http://localhost:${env.SERVER_PORT}`);
  } catch (err) {
    Logger.error(err);
    process.exit(1);
  }
};

const startPrivateApp = async () => {
  try {
    await privateApp.listen({ port: env.PRIVATE_APP_PORT, host: env.PRIVATE_APP_HOST });
    Logger.info(`Private server listening on port http://${env.PRIVATE_APP_HOST}:${env.PRIVATE_APP_PORT}`);
    Logger.info(`Spotify redirect URI: ${env.SPOTIFY_REDIRECT_URI}`);
    Logger.info(`Please visit http://${env.PRIVATE_APP_HOST}:${env.PRIVATE_APP_PORT}/login to authorize the Spotify integration.`);
  } catch (err) {
    Logger.error(err);
    process.exit(1);
  }
};

const shutdown = async () => {
  Logger.info("Shutting down...");
  await app.close();
  await privateApp.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start();
startPrivateApp();

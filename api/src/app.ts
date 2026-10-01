import Fastify, { FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { env } from "./lib/env";
import { errorsPlugin } from "./lib/errors";
import { getTrustedProxies } from "./lib/trusted-proxies";
import nowPlayingModule from "./modules/now-playing";
import barqStatusModule from "./modules/barq-status";
import barqUserCountModule from "./modules/barq-user-count";
import githubStatsModule from "./modules/github-stats";
import spotifyAuthModule from "./internal/spotify-auth";

type AppOptions = Pick<FastifyServerOptions, "logger">;

function createServer(options: AppOptions, isPrivate = false) {
  const app = Fastify({
    logger: options.logger ?? true,
    trustProxy: getTrustedProxies(env.TRUSTED_PROXIES, env.NODE_ENV === "production"),
    // OAuth callback URLs contain codes and state. Never log incoming auth URLs.
    disableRequestLogging: isPrivate,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  return app;
}

export async function buildApp(options: AppOptions = {}) {
  const app = createServer(options);
  await errorsPlugin(app);
  const origins = env.CORS_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  app.register(cors, { origin: origins.length ? origins : false });
  app.register(nowPlayingModule);
  app.register(barqStatusModule);
  app.register(barqUserCountModule);
  app.register(githubStatsModule);
  await app.ready();
  app.log.info({ corsEnabled: origins.length > 0, corsOrigins: origins }, "Public API CORS configuration");
  return app;
}

export async function buildPrivateApp(options: AppOptions = {}) {
  const app = createServer(options, true);
  app.setErrorHandler((error, _req, reply) => {
    const code = error && typeof error === "object" && "statusCode" in error ? error.statusCode : undefined;
    const status = typeof code === "number" && code >= 400 && code < 500 ? code : 500;
    reply.code(status).send({ error: status === 500 ? "Authorization failed" : "Invalid authorization request" });
  });
  app.register(spotifyAuthModule);
  await app.ready();
  return app;
}

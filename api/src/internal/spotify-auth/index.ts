import { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildSpotifyAuthUrl, exchangeCodeForRefreshToken } from "./repositories/spotify-auth-repo";
import { SpotifyAuthCallbackQuery } from "./dtos/spotify-auth-dto";

export default async function spotifyAuthModule(fastify: FastifyInstance) {
  await fastify.register(import("@fastify/rate-limit"), {
    max: 30,
    timeWindow: "1 minute",
  });

  fastify.get("/login", async (_req, reply) => {
    return reply.redirect(buildSpotifyAuthUrl());
  });

  fastify.get(
    "/api/callback",
    {
      schema: { querystring: SpotifyAuthCallbackQuery },
    },
    async (req, reply) => {
      const { code } = req.query as z.infer<typeof SpotifyAuthCallbackQuery>;
      await exchangeCodeForRefreshToken(code);

      return reply.send({
        success: true,
        message: "Refresh token updated. You can close this tab.",
      });
    }
  );
}

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { GithubStatsResponse } from "./dtos/github-dto";
import { createGithubStatsService, GithubStatsError } from "./repositories/github-repo";

export default async function githubStatsModule(fastify: FastifyInstance) {
  const service = createGithubStatsService();
  fastify.addHook("onClose", async () => service.close());
  await fastify.register(import("@fastify/rate-limit"), {
    max: 30,
    timeWindow: "1 minute",
  });

  fastify.get("/api/github/stats", {
    schema: {
      response: {
        200: GithubStatsResponse,
        502: z.object({ error: z.string() }),
        503: z.object({ error: z.string() }),
      },
    },
  }, async (_req, reply) => {
    // Cache only on the server, so credential/config changes are not hidden by a CDN.
    reply.header("Cache-Control", "no-store");
    try {
      return await service.getStats();
    } catch (error) {
      if (error instanceof GithubStatsError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });
}

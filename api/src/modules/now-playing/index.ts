import { FastifyInstance } from "fastify";
import { getCurrentlyPlaying } from "./use-cases/get-currently-playing";

export default async function nowPlayingModule(fastify: FastifyInstance) {
  fastify.get("/api/now-playing", async (_req, reply) => {
    try {
      const data = await getCurrentlyPlaying();
      return data ?? { isPlaying: false };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: "Failed to fetch currently playing" });
    }
  });
}

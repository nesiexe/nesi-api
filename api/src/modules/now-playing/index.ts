import { FastifyInstance } from "fastify";
import { fetchCurrentlyPlaying } from "./repositories/spotify-repo";

export default async function nowPlayingModule(fastify: FastifyInstance) {
  await fastify.register(import('@fastify/rate-limit'), {
    max: 30,
    timeWindow: '1 minute'
  });

  fastify.get("/api/now-playing",
  async (_req, reply) => {
    const data = await fetchCurrentlyPlaying();
    return data ?? { isPlaying: false };
  });
}

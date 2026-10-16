import { z } from "zod";
import { SpotifyUsername } from "../../lib/spotify-tokens";
import { FastifyInstance } from "fastify";
import { fetchCurrentlyPlaying } from "./repositories/spotify-repo";

export default async function nowPlayingModule(fastify: FastifyInstance) {
  await fastify.register(import('@fastify/rate-limit'), {
    max: 30,
    timeWindow: '1 minute'
  });

  fastify.get<{ Params: { username: z.infer<typeof SpotifyUsername> } }>("/api/now-playing/:username", {
    schema: { params: z.object({ username: SpotifyUsername }) },
  },
  async (req, _reply) => {
    const data = await fetchCurrentlyPlaying(req.params.username);
    return data ?? { isPlaying: false };
  });
}

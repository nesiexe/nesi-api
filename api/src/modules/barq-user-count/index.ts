import { FastifyInstance } from "fastify";
import { getBarqUserCount } from "./repositories/contact";



export default async function barqUserCountModule(fastify: FastifyInstance) {
  await fastify.register(import('@fastify/rate-limit'), {
    max: 30,
    timeWindow: '1 minute'
  });

  fastify.get("/api/barq/user-count",
  async (_req, _reply) => {
    const data = await getBarqUserCount();
    return data;
  });
}

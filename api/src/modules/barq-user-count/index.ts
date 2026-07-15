import { FastifyInstance } from "fastify";
import { getBarqUsers } from "./use-cases/barq-user-count"

export default async function barqUserCountModule(fastify: FastifyInstance) {
  fastify.get(
    "/api/barq/user-count",
    async (_req, reply) => {
        try {
          const data = await getBarqUsers();
          return data;
        } catch (err) {
          fastify.log.error(err);
          return reply.status(500).send({ error: "Failed to fetch user count" });
        }
      });
}

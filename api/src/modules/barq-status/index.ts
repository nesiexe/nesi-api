import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getBarqStatus } from "./use-cases/get-barq-status";
import { BarqQuerystring } from "./dtos/barq-dto";

export default async function barqStatusModule(fastify: FastifyInstance) {
  fastify.get(
    "/api/barq/status",
    { schema: { querystring: BarqQuerystring } },
    async (req) => {
      const { uuid } = req.query as z.infer<typeof BarqQuerystring>;
      const result = await getBarqStatus(uuid);
      return result;
    }
  );
}

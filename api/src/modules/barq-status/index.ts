import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getBarqStatusForUuid } from "./repositories/barq-repo";
import { BarqQuerystring } from "./dtos/barq-dto";

export default async function barqStatusModule(fastify: FastifyInstance) {
  await fastify.register(import('@fastify/rate-limit'), {
    max: 30,
    timeWindow: '1 minute'
  });

  fastify.get(
    "/api/barq/status",
    {
      schema: { querystring: BarqQuerystring },
    },
    async (req) => {
      const { uuid } = req.query as z.infer<typeof BarqQuerystring>;
      const data = await getBarqStatusForUuid(uuid);

      return {
        username: data?.username ?? undefined,
        pfp: data?.pfp ?? undefined,
        status: data?.status ?? undefined,
        expiresAt: data?.expiresAt ?? undefined,
        uuid: uuid ?? data?.uuid ?? "",
        hasStatus: !!data && !!data.status,
      };
    }
  );
}

import { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { UpstreamError } from "./upstream";

export class NotFoundError extends Error {
  statusCode = 404;
}

export class BadRequestError extends Error {
  statusCode = 400;
}

export class ConflictError extends Error {
  statusCode = 409;
}

export class UnauthorizedError extends Error {
  statusCode = 401;
}

export async function errorsPlugin(fastify: FastifyInstance) {
  fastify.setErrorHandler((err, _req, reply) => {
    if (err instanceof UpstreamError) {
      return reply.status(err.statusCode).send({ error: err.message });
    }
    if (err && typeof err === "object" && "statusCode" in err && err.statusCode === 429) {
      return reply.status(429).send({ error: "Too many requests" });
    }

    if (err && typeof err === "object" && "validation" in err) {
      return reply.status(400).send({ error: "Validation error" });
    }

    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: "Validation error",
        details: err.issues,
      });
    }

    if (err instanceof NotFoundError || err instanceof BadRequestError || err instanceof ConflictError || err instanceof UnauthorizedError) {
      return reply.status(err.statusCode).send({ error: err.message });
    }

    fastify.log.error(err);
    return reply.status(500).send({ error: "Internal server error" });
  });
}

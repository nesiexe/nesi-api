import { FastifyInstance } from "fastify";
import { ZodError } from "zod";

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

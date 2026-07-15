import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import cors from "@fastify/cors";
import { env } from "./lib/env";
import { errorsPlugin } from "./lib/errors";
import nowPlayingModule from "./modules/now-playing";
import barqStatusModule from "./modules/barq-status";
import barqUserCountModule from "./modules/barq-user-count";

const app = Fastify({ logger: true });

app.register(cors, { origin: env.CORS_ORIGIN ? [env.CORS_ORIGIN] : false });

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

app.register(errorsPlugin);
app.register(nowPlayingModule);
app.register(barqStatusModule);
app.register(barqUserCountModule)

const start = async () => {
  try {
    await app.listen({ port: env.SERVER_PORT, host: "127.0.0.1" });
    app.log.info(`Server listening on port http://localhost:${env.SERVER_PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();

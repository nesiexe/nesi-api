import { config } from "dotenv";
import path from "path";
import { z } from "zod";

config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  SERVER_PORT: z.coerce.number().default(3002),
  PRIVATE_APP_PORT: z.coerce.number().default(3003),
  PRIVATE_APP_HOST: z.string().default("10.0.0.60"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
  CORS_ORIGINS: z.string().optional(),
  SPOTIFY_REDIRECT_URI: z.string().default("http://10.0.0.60:3003/api/callback"),
  SPOTIFY_CLIENT_ID: z.string().optional(),
  SPOTIFY_CLIENT_SECRET: z.string().optional(),
  SPOTIFY_REFRESH_TOKEN: z.string().optional(),
  BARQ_API_KEY: z.string().optional(),
  BARQ_ALLOWED_UUIDS: z.string().optional(),
  BARQ_DEFAULT_UUID: z.string().uuid().optional(),
});

export const env = envSchema.parse(process.env);

const envPath = path.resolve(process.cwd(), ".env");

export function reloadEnv() {
  config({ path: envPath, override: true });
  Object.assign(env, envSchema.parse(process.env));
}

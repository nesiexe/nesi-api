import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  SERVER_PORT: z.coerce.number().default(3002),
  SERVER_HOST: z.string().default("0.0.0.0"),
  PRIVATE_APP_PORT: z.coerce.number().default(3003),
  PRIVATE_APP_HOST: z.string().default("127.0.0.1"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
  CORS_ORIGINS: z.string().optional(),
  TRUSTED_PROXIES: z.string().optional(),
  SPOTIFY_REDIRECT_URI: z.string().default("http://127.0.0.1:3003/api/callback"),
  SPOTIFY_AUTH_PASSWORD: z.union([z.literal(""), z.string().min(32).max(256)]).optional(),
  SPOTIFY_CLIENT_ID: z.string().optional(),
  SPOTIFY_CLIENT_SECRET: z.string().optional(),
  SPOTIFY_REFRESH_TOKEN: z.string().optional(),
  SPOTIFY_TOKEN_FILE: z.string().min(1).default(".secrets/spotify-refresh-token"),
  BARQ_API_KEY: z.string().optional(),
  BARQ_ALLOWED_UUIDS: z.string().optional(),
  BARQ_DEFAULT_UUID: z.string().uuid().optional(),
  GITHUB_USERNAME: z.string().trim().optional(),
  GITHUB_TOKEN: z.string().trim().optional(),
});

export const env = envSchema.parse(process.env);

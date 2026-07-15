import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  SERVER_PORT: z.coerce.number().default(3000),
  CORS_ORIGIN: z.string().optional(),
  SPOTIFY_CLIENT_ID: z.string().optional(),
  SPOTIFY_CLIENT_SECRET: z.string().optional(),
  SPOTIFY_REFRESH_TOKEN: z.string().optional(),
  BARQ_API_KEY: z.string().optional(),
  BARQ_ALLOWED_UUIDS: z.string().optional(),
  BARQ_DEFAULT_UUID: z.string().uuid().optional(),
});

export const env = envSchema.parse(process.env);

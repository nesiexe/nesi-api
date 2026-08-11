import { z } from "zod";

export const SpotifyAuthCallbackQuery = z.object({
  code: z.string(),
});

export const SpotifyTokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
});

export type SpotifyAuthCallbackQuery = z.infer<typeof SpotifyAuthCallbackQuery>;
export type SpotifyTokenResponse = z.infer<typeof SpotifyTokenResponse>;

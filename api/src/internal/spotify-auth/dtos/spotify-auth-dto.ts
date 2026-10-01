import { z } from "zod";

export const SpotifyAuthCallbackQuery = z.object({
  code: z.string().min(1).max(4096),
  state: z.string().regex(/^[a-f0-9]{64}$/),
});

export type SpotifyAuthCallbackQuery = z.infer<typeof SpotifyAuthCallbackQuery>;

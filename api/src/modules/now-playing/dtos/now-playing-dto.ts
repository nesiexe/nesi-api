import { z } from "zod";

export const NowPlayingQuery = z.object({});
export type NowPlayingQuery = z.infer<typeof NowPlayingQuery>;

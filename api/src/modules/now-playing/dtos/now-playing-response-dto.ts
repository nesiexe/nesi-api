import { z } from "zod";

export const SpotifyPlayerItem = z.object({
  name: z.string().nullable().optional(),
  artists: z.array(z.object({ name: z.string() })).nullable().optional(),
  album: z.object({ images: z.array(z.object({ url: z.string() })).optional() }).nullable().optional(),
  external_urls: z.object({ spotify: z.string().optional() }).nullable().optional(),
});

export const SpotifyPlayerResponse = z.object({
  item: SpotifyPlayerItem.nullable().optional(),
  is_playing: z.boolean().optional(),
});

export const NowPlayingResult = z.object({
  track: z.string().nullable(),
  artist: z.string().nullable(),
  albumArt: z.string().nullable(),
  url: z.string().nullable(),
  isPlaying: z.boolean(),
});

export type NowPlayingResult = z.infer<typeof NowPlayingResult>;

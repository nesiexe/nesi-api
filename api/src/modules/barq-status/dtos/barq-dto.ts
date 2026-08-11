import { z } from "zod";

export const BarqQuerystring = z.object({
  uuid: z.uuid().optional(),
});

export const BarqStatusResponse = z.object({
  username: z.string().optional(),
  pfp: z.string().optional(),
  status: z.string().optional(),
  expiresAt: z.iso.datetime().optional(),
  uuid: z.uuid(),
  hasStatus: z.boolean(),
});

export type BarqQuerystring = z.infer<typeof BarqQuerystring>;
export type BarqStatusResponse = z.infer<typeof BarqStatusResponse>

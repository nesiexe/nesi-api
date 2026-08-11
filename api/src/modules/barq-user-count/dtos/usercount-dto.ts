import { z } from "zod";

export const BarqUserCountDto = z.object({
    userCount: z.number().int(),
});

export type BarqUserCountDto = z.infer<typeof BarqUserCountDto>;
import { z } from "zod";

export const BarqProfileSchema = z.object({
  displayName: z.string().optional(),
  primaryImage: z.object({ url: z.string().nullable().optional() }).nullable().optional(),
  temporaryStatus: z
    .object({ status: z.string().nullable().optional(), expiredAt: z.iso.datetime().nullable().optional() })
    .nullable()
    .optional(),
});

export const BarqGraphQLResponse = z.union([
  z.object({
    profile: BarqProfileSchema.optional(),
  }),
  z.object({
    data: z
      .object({
        profile: BarqProfileSchema.nullable().optional(),
      })
      .optional(),
  }),
]);

export const BarqStatusData = z.object({
  username: z.string().nullable(),
  pfp: z.string().nullable(),
  status: z.string().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  uuid: z.string(),
});

export type BarqStatusData = z.infer<typeof BarqStatusData>;

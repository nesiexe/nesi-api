import { env } from "../../../lib/env";
import { BarqGraphQLResponse, BarqStatusData } from "../dtos/barq-response-dto";
import { createCache } from "../../../lib/cache";
import { BadRequestError, NotFoundError } from "../../../lib/errors";
import { Logger } from "../../../lib/logger";
import { createUpstreamGuard, requestJson, UpstreamError } from "../../../lib/upstream";

const statusCache = createCache<BarqStatusData>(3_600_000);
const guard = createUpstreamGuard("barq-status", Logger);

export async function getBarqStatusForUuid(uuid?: string): Promise<BarqStatusData> {
  const id = uuid ?? env.BARQ_DEFAULT_UUID;
  if (!id) throw new BadRequestError("No UUID provided and no default configured");
  const allowed = env.BARQ_ALLOWED_UUIDS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  // The default must be explicitly allowed too. An empty list disables access.
  if (!allowed.includes(id)) throw new NotFoundError("UUID not allowed");
  if (!env.BARQ_API_KEY) throw new UpstreamError("http_error", 403);
  const data = await statusCache.fetch(id, () => guard(async () => {
    const response = await requestJson(`https://api.barq.app/api/profiles/${id}`, {
      headers: { Authorization: `Bearer ${env.BARQ_API_KEY}`, "Content-Type": "application/json" },
    });
    const parsed = BarqGraphQLResponse.safeParse(response.data);
    if (!parsed.success) throw new UpstreamError("invalid_response", response.status);
    const profile = "profile" in parsed.data ? parsed.data.profile
      : "data" in parsed.data ? parsed.data.data?.profile : null;
    return {
      username: profile?.displayName ?? null,
      pfp: profile?.primaryImage?.url ?? null,
      status: profile?.temporaryStatus?.status ?? null,
      expiresAt: profile?.temporaryStatus?.expiredAt ?? null,
      uuid: id,
    };
  }));
  if (data.expiresAt && new Date(data.expiresAt).getTime() <= Date.now()) {
    return { ...data, status: null, expiresAt: null };
  }
  return data;
}

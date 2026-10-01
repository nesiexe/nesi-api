import { createCache } from "../../../lib/cache";
import { Logger } from "../../../lib/logger";
import { BarqUserCountDto } from "../dtos/usercount-dto";
import { createUpstreamGuard, requestJson, UpstreamError } from "../../../lib/upstream";

const countCache = createCache<BarqUserCountDto>(3_600_000, { maxEntries: 1 });
const guard = createUpstreamGuard("barq-user-count", Logger);

export async function getBarqUserCount(): Promise<BarqUserCountDto> {
  return countCache.fetch("user-count", () => guard(async () => {
    const response = await requestJson("https://api.barq.app/api/public/user-count");
    const parsed = BarqUserCountDto.safeParse(response.data);
    if (!parsed.success) throw new UpstreamError("invalid_response", response.status);
    return { userCount: parsed.data.userCount ?? null };
  }));
}

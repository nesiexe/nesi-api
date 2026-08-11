import { createCache } from "../../../lib/cache";
import { BadRequestError } from "../../../lib/errors";
import { Logger } from "../../../lib/logger";
import { BarqUserCountDto } from "../dtos/usercount-dto";

const hour = (h: number) => h * 60 * 60 * 1000;

const countCache = createCache<BarqUserCountDto>(hour(1))

interface FetchResult {
  ok: true;
  data: BarqUserCountDto;
}

interface FetchError {
  ok: false;
  error: string;
  detail?: string;
}

async function fetchBarqUserCount(): Promise<FetchResult | FetchError> {
    Logger.debug(`fetching usercount`)
    const res = await fetch("https://api.barq.app/api/public/user-count", {
        method: "GET"
    })

    if (res.status === 429) {
       return { ok: false, error: "rate_limited" };
    }
    if (res.status !== 200) {
       const text = await res.text();
       return { ok: false, error: "server_error", detail: text };
    }

    const raw = await res.json() as unknown;
    const parsed = BarqUserCountDto.safeParse(raw)
    if (!parsed.success){
        return { ok: false, error: "invalid_response", detail: parsed.error.message };
    }

    const userCount = parsed.data.userCount ?? null;
    
    const result: BarqUserCountDto = {
        userCount
    }

    return { ok: true, data: result }
}

export async function getBarqUserCount(): Promise<BarqUserCountDto> {
    const cacheKey = "user-count"
    return countCache.fetch(cacheKey, async () => {
        const fetched = await fetchBarqUserCount();
        if (!fetched.ok) {
            throw new BadRequestError(`Barq API error: ${fetched.error}${fetched.detail ? ` - ${fetched.detail}` : ""}`)
        }

        return fetched.data;
    })
}
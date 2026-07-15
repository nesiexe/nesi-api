import { env } from "../../../lib/env";
import { BarqGraphQLResponse, BarqStatusData } from "../dtos/barq-response-dto";
import { createCache } from "../../../lib/cache";
import { BadRequestError, NotFoundError } from "../../../lib/errors";
import { Logger } from "../../../lib/logger";

const allowed_uuids = env.BARQ_ALLOWED_UUIDS
  ? env.BARQ_ALLOWED_UUIDS.split(",").map((s) => s.trim())
  : [];

const default_barq_uuid = env.BARQ_DEFAULT_UUID;

const hour = (h: number) => h * 60 * 60 * 1000;

const statusCache = createCache<BarqStatusData | null>(hour(1));

interface FetchResult {
  ok: true;
  data: BarqStatusData;
  expiresAt: Date;
}

interface FetchError {
  ok: false;
  error: string;
  detail?: string;
}

async function fetchBarqTempStatusAPI(uuid: string): Promise<FetchResult | FetchError> {
  if (!env.BARQ_API_KEY) return { ok: false, error: "missing api key" };

  Logger.warn(`fetching barq status for ${uuid}`)
  const res = await fetch(`https://api.barq.app/api/profiles/${uuid}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${env.BARQ_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (res.status === 422) {
    return { ok: false, error: "rate_limited" };
  }
  if (res.status !== 200) {
    const text = await res.text();
    return { ok: false, error: "server_error", detail: text };
  }

  const raw = (await res.json()) as unknown;
  const parsed = BarqGraphQLResponse.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "invalid_response", detail: parsed.error.message };
  }

  const profile = "profile" in parsed.data
    ? parsed.data.profile ?? null
    : "data" in parsed.data
      ? parsed.data.data?.profile ?? null
      : null;
  const pfpImage = profile?.primaryImage?.url ?? null;
  let username = profile?.displayName ?? null;
  let status = profile?.temporaryStatus?.status ?? null;
  let expiresAt = profile?.temporaryStatus?.expiredAt ?? null;
  const expiresAtDate = expiresAt ? new Date(expiresAt) : null;

  if (expiresAtDate !== null && expiresAtDate.getTime() < Date.now()) {
    status = null;
    expiresAt = null;
  }

  const result: BarqStatusData = {
    username: username,
    pfp: pfpImage,
    status,
    expiresAt,
    uuid,
  };

  return { ok: true, data: result, expiresAt: expiresAtDate ?? new Date(Date.now() + hour(1)) };
}

export async function getBarqStatusForUuid(uuid?: string): Promise<BarqStatusData | null> {
  const id = uuid ?? default_barq_uuid;
  if (!id) {
    throw new BadRequestError("No UUID provided and no default configured");
  }
  if (allowed_uuids.length > 0 && !allowed_uuids.includes(id)) {
    throw new NotFoundError("UUID not allowed");
  }

  const cached = statusCache.get(id);
  if (cached !== undefined) return cached;

  const fetched = await fetchBarqTempStatusAPI(id);
  if (!fetched.ok) {
    throw new BadRequestError(`Barq API error: ${fetched.error}${fetched.detail ? ` - ${fetched.detail}` : ""}`);
  }

  statusCache.set(id, fetched.data);
  Logger.debug("cache expires at" + new Date(Date.now() + hour(1)))
  return fetched.data;
}

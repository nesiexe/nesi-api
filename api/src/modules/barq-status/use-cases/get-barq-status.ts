import { getBarqStatusForUuid } from "../repositories/barq-repo";
import { BarqStatusResponse } from "../dtos/barq-dto";

export async function getBarqStatus(uuid?: string): Promise<BarqStatusResponse> {
  const data = await getBarqStatusForUuid(uuid);

  const hasStatus = !!data && !!data.status;
  const status = data?.status ?? undefined;
  const expiresAt = data?.expiresAt ?? undefined;

  return {
    username: data?.username ?? undefined,
    pfp: data?.pfp ?? undefined,
    status,
    expiresAt,
    uuid: uuid ?? data?.uuid ?? "",
    hasStatus,
  };
}

import { loadLag, type LagResult } from "@/lib/lag-result";
import type { ServerPayload } from "@/lib/types";
import { LAG_KEYS } from "@shared/lag";
import { publicServer } from "@shared/server";

export async function getServerSnapshot(): Promise<LagResult<ServerPayload>> {
  const stored = await loadLag<ServerPayload>(LAG_KEYS.server, "尚未收到落地节点上报");
  return stored.map((data) => ({ ...publicServer(data), pushedAt: data.pushedAt }));
}

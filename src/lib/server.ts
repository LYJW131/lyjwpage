import { loadLag, type LagResult } from "@/lib/lag-result";
import type { ServerPayload } from "@/lib/types";
import { LAG_KEYS } from "@shared/lag";

export function getServerSnapshot(): Promise<LagResult<ServerPayload>> {
  return loadLag<ServerPayload>(LAG_KEYS.server, "尚未收到落地节点上报");
}

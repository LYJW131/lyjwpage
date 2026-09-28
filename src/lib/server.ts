import { loadLag, type LagResult } from "@/lib/lag-result";
import type { ServerPayload } from "@/lib/types";
import { LAG_KEYS } from "@shared/lag";

/** 落地节点最新一封，由上报入口写进可滞后层；过没过时由浏览器按 updatedAt 判断 */
export function getServerSnapshot(): Promise<LagResult<ServerPayload>> {
  return loadLag<ServerPayload>(LAG_KEYS.server, "尚未收到落地节点上报");
}

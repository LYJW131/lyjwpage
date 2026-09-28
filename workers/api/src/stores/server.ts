import { normalizeServer } from "@/lib/server-parse";
import type { ServerStatus } from "@/lib/types";

/**
 * 落地节点的上报只做收敛：整封在可滞后层，由上报入口直接写 KV（lag-ingest），
 * 不经过状态核心。每封都重写 `updatedAt`：这份快照本身就是心跳，浏览器拿它判断
 * 上报器是不是还在推。不广播，数字每个间隔都在变，推它们等于把推送当轮询用。
 */
export type PreparedServerReport = { source: "server"; receivedAt: number; status: ServerStatus };

export function prepareServerReport(input: unknown, receivedAt = Date.now()): PreparedServerReport {
  return { source: "server", receivedAt, status: normalizeServer(input) };
}

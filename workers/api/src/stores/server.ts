import { serverStaleMs } from "@/lib/freshness";
import { SERVER_TAG } from "@/lib/live-events";
import { normalizeServer } from "@/lib/server-parse";
import { fanout } from "@api/fanout";
import { mirror } from "@shared/server";
import type { ServerStatus } from "@/lib/types";

/**
 * 每封都落库：这份快照本身就是心跳，不刷新 receivedAt 的话读那侧永远判不出
 * 上报器是什么时候死的。
 *
 * 不广播。数字每个间隔都在变，推它们等于把推送当轮询用。首屏 tag 也只在布局
 * 变了时发（见 lib/home-layout）：卡片由空变有、流量那一行出现或消失、上报器从
 * 断流里回来。读数本身交给首屏的定时重建，浏览器挂载后直接问 Worker 拿最新的。
 */
export async function recordServerReport(input: unknown, receivedAt = Date.now()) {
  return commitPreparedServerReport(prepareServerReport(input, receivedAt));
}

export type PreparedServerReport = { source: "server"; receivedAt: number; status: ServerStatus };

export function prepareServerReport(input: unknown, receivedAt = Date.now()): PreparedServerReport {
  return { source: "server", receivedAt, status: normalizeServer(input) };
}

export async function commitPreparedServerReport({ status, receivedAt }: PreparedServerReport) {
  const previous = await mirror.get();
  const layoutChanged =
    !previous ||
    receivedAt - previous.receivedAt > serverStaleMs() ||
    (previous.status.traffic == null) !== (status.traffic == null);

  await fanout({
    writes: [mirror.put({ status, receivedAt })],
    tags: layoutChanged ? [SERVER_TAG] : [],
  });

  return { id: status.id };
}

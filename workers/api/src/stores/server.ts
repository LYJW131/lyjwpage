import { displayChanged } from "@shared/display-change";
import { serverState } from "@shared/state-journal";
import { SERVER_TAG } from "@/lib/live-events";
import { normalizeServer } from "@/lib/server-parse";
import { fanout } from "@api/fanout";
import { recordStateChange } from "@api/stores/state-journal";
import { mirror } from "@shared/server";
import type { ServerStatus } from "@/lib/types";

/**
 * 每封都落库：这份快照本身就是心跳，不刷新 receivedAt 的话读那侧永远判不出
 * 上报器是什么时候死的。
 *
 * 不广播。数字每个间隔都在变，推它们等于把推送当轮询用。tag 每次都推，走普通
 * 那半 —— 不推的话 `'use cache'` 里那份快照跟着冻住，卡片 30 秒一轮问到的还是
 * 几分钟前的 CPU。第一次用 urgent：空卡变成有数据，不能再给旧的降级信封顶几分钟。
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
  const changed = displayChanged(previous?.status, status);

  await fanout({
    writes: [(async () => {
      await mirror.put({ status, receivedAt });
      await recordStateChange("server", receivedAt, serverState(status));
    })()],
    tags: changed ? [SERVER_TAG] : [],
  });

  return { id: status.id };
}

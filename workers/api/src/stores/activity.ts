import { replacePulseActivity } from "@api/stores/pulse";
import type { ActivityReport } from "@shared/activity";

/**
 * 状态核心这一半只落 Pulse 的五分钟桶（步数、活动千卡、锻炼分钟，不换算成档位）。
 * 当天圆环读数是展示快照，由上报入口写进可滞后层（见 workers/ingress 的 lag-ingest）。
 * 收敛在上报入口，见 shared/ingest/activity.ts。
 *
 * **两边都没有「旧的不许盖新的」那道闸，也不该有。** 上报器每封都发当天的全量绝对值、
 * 发的都是它此刻看到的真相，而且失败了不补发旧报文（见那边的 README）—— 这两件事
 * 是一对：哪天给上报器加了后台重试队列，这里就得把顺序闸一起加回来。
 *
 * 按日期挡也不行：往西飞过日界线时本地日会往回走一天，而手表上的圈确实跟着回去了。
 */
export async function writeActivity(report: ActivityReport): Promise<void> {
  if (report.history) await replacePulseActivity(report.history, report.history.buckets);
}

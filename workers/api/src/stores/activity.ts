import { replacePulseActivity } from "@api/stores/pulse";
import type { ActivityReport } from "@shared/activity";

// 手表本地日可因跨日界线倒退，不能按日期拒收；此处依赖上报器不重放旧报文。
export async function writeActivity(report: ActivityReport): Promise<void> {
  if (report.history) await replacePulseActivity(report.history, report.history.buckets);
}

import { sinceDateParam, statusRoute } from "@/lib/api";
import { vibeCodingYearStatus } from "@/lib/status-cache";
import { sliceVibeCodingYear, withYearFreshness } from "@/lib/vibecoding-year";

export function GET(request: Request) {
  const since = sinceDateParam(request);
  // 「源站此刻是哪一天」每次请求现算：它光靠时间流逝就会翻面，冻在缓存里那份会
  // 让热力图一直停在昨天，见 lib/vibecoding-year 的 withYearFreshness
  return statusRoute(vibeCodingYearStatus, (data) =>
    sliceVibeCodingYear(withYearFreshness(data), since),
  );
}

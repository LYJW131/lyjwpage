import { AwaitingReport } from "@/lib/awaiting-report";
import { mergeCursorUsage } from "@/lib/cursor-usage";
import type { VibeCodingYearPayload } from "@/lib/types";
import { normalizeVibeCodingUsage } from "@/lib/vibecoding-parse";
import { withYearFreshness } from "@/lib/vibecoding-year";
import { cursorUsageMirror } from "@shared/cursor-usage";
import { usageMirror } from "@shared/vibecoding";
import { yearMirror } from "@shared/vibecoding-year-store";

export async function getVibeCodingYear(): Promise<VibeCodingYearPayload> {
  const [stored, usageState, cursorState] = await Promise.all([
    yearMirror.get(),
    usageMirror.get(),
    cursorUsageMirror.get(),
  ]);
  if (!stored) throw new AwaitingReport("尚未收到 Mac Telemetry Hub 的年度用量推送");
  const usage = usageState ? normalizeVibeCodingUsage(usageState.payload) : null;
  const merged = usage
    ? mergeCursorUsage(usage, cursorState?.report ?? null, stored, Date.now()).year ?? stored
    : stored;
  // 「今天是哪一天」不进 SQLite，取数出口现盖一次，见 withYearFreshness
  return withYearFreshness(merged);
}

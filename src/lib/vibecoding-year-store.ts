import { mirrorKey } from "@/lib/redis";
import type { VibeCodingYearPayload } from "@/lib/types";
import { YEAR_DAYS, normalizeVibeCodingYear } from "@/lib/vibecoding-year";

const yearMirror = mirrorKey<VibeCodingYearPayload>(
  ["vibecoding", "year"],
  (state) => state.pushedAt,
);

export function prepareVibeCodingYear(report: unknown, receivedAt = Date.now()) {
  const payload = normalizeVibeCodingYear(report);
  if (!payload) throw new Error("vibeCodingYear 必须是从周日切起的 53 周日合计，并带每天前五的模型表");
  if (payload.days.length !== YEAR_DAYS) {
    throw new Error("vibeCodingYear.days 必须覆盖整整 53 周");
  }
  return {
    commit: () => yearMirror.put({ ...payload, pushedAt: receivedAt }),
  };
}

export async function getVibeCodingYear(): Promise<VibeCodingYearPayload> {
  const stored = await yearMirror.get();
  if (!stored) throw new Error("尚未收到 Mac Telemetry Hub 的年度用量推送");
  return stored;
}

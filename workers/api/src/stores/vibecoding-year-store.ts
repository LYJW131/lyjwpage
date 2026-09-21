import { normalizeVibeCodingYear } from "@/lib/vibecoding-year";
import type { StoredVibeCodingYear } from "@/lib/types";
import { yearMirror } from "@shared/vibecoding-year-store";

export function prepareVibeCodingYear(report: unknown, receivedAt = Date.now()) {
  const payload = normalizeVibeCodingYear(report);
  if (!payload) throw new Error("vibeCodingYear 必须是从周日切起的 53 周日合计，并带每天前五的模型表");
  return prepareVibeCodingYearPayload(payload, receivedAt);
}

export function prepareVibeCodingYearPayload(
  payload: Omit<StoredVibeCodingYear, "pushedAt">,
  receivedAt: number,
) {
  return {
    payload,
    commit: () => yearMirror.put({ ...payload, pushedAt: receivedAt }),
  };
}

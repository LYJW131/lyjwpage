import type { StoredVibeCodingYear } from "@/lib/types";
import { yearMirror } from "@shared/vibecoding-year-store";

/** 年度热力图那份已经在上报入口校验过（shared/ingest/telemetry.ts），这里只包成写 */
export function prepareVibeCodingYearPayload(
  payload: Omit<StoredVibeCodingYear, "pushedAt">,
  receivedAt: number,
) {
  return {
    payload,
    commit: () => yearMirror.put({ ...payload, pushedAt: receivedAt }),
  };
}

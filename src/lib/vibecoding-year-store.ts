import { mirrorKey } from "@/lib/redis";
import type { VibeCodingYearPayload } from "@/lib/types";
import {
  YEAR_DAYS,
  chunkStarts,
  normalizeVibeCodingYear,
  sliceYearDays,
} from "@/lib/vibecoding-year";

type StoredYear = {
  origin: string;
  days: number[];
  pushedAt: number;
};

const yearMirror = mirrorKey<StoredYear>(
  ["vibecoding", "year"],
  (state) => state.pushedAt,
);

export function prepareVibeCodingYear(report: unknown, receivedAt = Date.now()) {
  const chunk = normalizeVibeCodingYear(report);
  if (!chunk) throw new Error("vibeCodingYear 必须是从周日切起的一块日合计");
  return {
    commit: async () => {
      const previous = await yearMirror.get();
      const days =
        previous && previous.origin === chunk.origin && previous.days.length === YEAR_DAYS
          ? previous.days.slice()
          : Array.from({ length: YEAR_DAYS }, () => 0);
      const offset = Math.round(
        (Date.parse(`${chunk.from}T00:00:00Z`) - Date.parse(`${chunk.origin}T00:00:00Z`)) /
          86_400_000,
      );
      for (let index = 0; index < chunk.days.length; index += 1) {
        days[offset + index] = chunk.days[index] ?? 0;
      }
      await yearMirror.put({ origin: chunk.origin, days, pushedAt: receivedAt });
    },
  };
}

export async function getVibeCodingYearChunk(from?: string): Promise<VibeCodingYearPayload> {
  const stored = await yearMirror.get();
  if (!stored) throw new Error("尚未收到 Mac Telemetry Hub 的年度用量推送");

  const starts = chunkStarts(stored.origin);
  const wanted = from && starts.includes(from) ? from : starts[starts.length - 1];
  if (!wanted) throw new Error("年度用量窗口是空的");

  return {
    origin: stored.origin,
    from: wanted,
    days: sliceYearDays(stored.days, stored.origin, wanted),
    pushedAt: stored.pushedAt,
  };
}

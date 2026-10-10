// LastPlayedDate 不在默认 UserData 里，不点名就永远没有 playedAt。
export const RESUME_FIELDS = [
  "ProductionYear",
  "SeriesPrimaryImage",
  "BasicSyncInfo",
  "UserDataPlayCount",
  "UserDataLastPlayedDate",
].join(",");

const MIN_PLAYED_YEAR = 2000;

type ProgressSource = {
  RunTimeTicks?: number;
  UserData?: {
    PlayedPercentage?: number | null;
    PlaybackPositionTicks?: number | null;
  };
};

// PlayedPercentage 可以是 0，续播位置在 PlaybackPositionTicks。刻度为 0 才退回百分比：有的查询把刻度报成 0，不能反过来把百分比清掉。
export function resolveProgress(item: ProgressSource): number {
  const userData = item.UserData ?? {};
  const position = Number(userData.PlaybackPositionTicks);
  const runtime = Number(item.RunTimeTicks);
  if (Number.isFinite(position) && position > 0 && Number.isFinite(runtime) && runtime > 0) {
    return Math.min(100, Math.max(0, (position / runtime) * 100));
  }

  const percentage = Number(userData.PlayedPercentage);
  if (userData.PlayedPercentage != null && Number.isFinite(percentage)) {
    return Math.min(100, Math.max(0, percentage));
  }
  return 0;
}

// 无时区按 UTC。7 位小数收成 toISOString 的毫秒，才能过 apps/ios/Core/Formatting.swift#ISO8601Parsing。
export function normalizePlayedAt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/i.test(trimmed) ? trimmed : `${trimmed}Z`;
  const ms = Date.parse(zoned);
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  if (date.getUTCFullYear() < MIN_PLAYED_YEAR) return null;
  return date.toISOString();
}

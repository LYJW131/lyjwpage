// 列表默认不带片长和上次播放时间，PlayedPercentage 会变成 0。
export const RESUME_FIELDS = [
  "ProductionYear",
  "SeriesPrimaryImage",
  "BasicSyncInfo",
  "UserDataPlayCount",
  "UserDataLastPlayedDate",
  "RunTimeTicks",
] as const;

type ResumeUserData = {
  PlayedPercentage?: number | null;
  PlaybackPositionTicks?: number | null;
};

type ResumeClock = {
  RunTimeTicks?: number | null;
  UserData?: ResumeUserData | null;
};

function tickPercent(position: number, runtime: number): number | null {
  if (!Number.isFinite(position) || !Number.isFinite(runtime) || position <= 0 || runtime <= 0) {
    return null;
  }
  return Math.min(100, (position / runtime) * 100);
}

export function resumeProgress(item: ResumeClock): number {
  const fromTicks = tickPercent(
    Number(item.UserData?.PlaybackPositionTicks),
    Number(item.RunTimeTicks),
  );
  if (fromTicks != null) return fromTicks;

  const raw = item.UserData?.PlayedPercentage;
  const percentage = Number(raw);
  if (raw != null && Number.isFinite(percentage)) {
    return Math.min(100, Math.max(0, percentage));
  }
  return 0;
}

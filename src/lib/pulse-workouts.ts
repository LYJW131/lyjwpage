import type { Workout } from "@/lib/types";

/**
 * 名称在 24 小时泳道上占的大致宽度。窄屏上 “Fencing” 大约占这么一块，
 * 用来决定标签会不会互相压住、以及贴右边时要不要改成右对齐。
 */
const LABEL_FRACTION = 0.3;

export type PulseWorkoutSource = Pick<
  Workout,
  "id" | "activityType" | "startedAt" | "endedAt" | "durationSeconds"
>;

/** 一条落在 Pulse 窗口里的已完成训练。位置是窗口宽度的比例，0 是窗口左端。 */
export type PulseWorkoutMark = PulseWorkoutSource & {
  start: number;
  span: number;
  /** 名称标签的左端。贴右边放不下时改成右对齐，这个值仍是标签占用区间的左端。 */
  labelStart: number;
  /** 标签右端贴住训练结束时刻，避免名称画出泳道。 */
  alignEnd: boolean;
  row: number;
};

/**
 * 最近 24 小时里和窗口有交集的训练，按开始时间从左到右排。
 *
 * 圆环估算仍走原来的 Jev 活动分；这里只标项目名和时间，不改强度。
 * 窗口外的记录直接丢掉，不外推、不补一条没有上报的训练。
 */
export function pulseWorkoutMarks(
  items: readonly PulseWorkoutSource[],
  window: { from: number; to: number },
): PulseWorkoutMark[] {
  const width = window.to - window.from;
  if (!(width > 0)) return [];
  const visible = items
    .filter((item) => item.endedAt > item.startedAt && item.endedAt > window.from && item.startedAt < window.to)
    .slice()
    .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  const rowEnds: number[] = [];
  return visible.map((item) => {
    const from = Math.max(item.startedAt, window.from);
    const to = Math.min(item.endedAt, window.to);
    const start = (from - window.from) / width;
    const span = (to - from) / width;
    const end = start + span;
    const alignEnd = start + LABEL_FRACTION > 1;
    const labelStart = alignEnd ? Math.max(0, end - LABEL_FRACTION) : start;
    const labelEnd = alignEnd ? end : Math.min(1, start + LABEL_FRACTION);
    let row = rowEnds.findIndex((used) => used <= labelStart);
    if (row < 0) {
      row = rowEnds.length;
      rowEnds.push(labelEnd);
    } else {
      rowEnds[row] = labelEnd;
    }
    return {
      id: item.id,
      activityType: item.activityType,
      startedAt: item.startedAt,
      endedAt: item.endedAt,
      durationSeconds: item.durationSeconds,
      start,
      span,
      labelStart,
      alignEnd,
      row,
    };
  });
}

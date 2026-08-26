/**
 * 53 周热力图的窗口切片。
 *
 * 充电头曲线的游标是最后一个采样点的毫秒时刻，新点只往后追加，所以 `?since=`
 * 是开区间。格子不是这样：最后一天（今天）的数字还会涨，锁在页面上的那天
 * 也得再问一次，游标按闭区间切。
 *
 * `since` 落在窗口里才发尾部；滚出窗口（周已经切走）就整份重发，和充电头
 * 「游标比最旧点还早」同一条规则。
 */

import { addDays } from "./github-chart-compact.ts";

export const HEATMAP_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isHeatmapDate(value: string): boolean {
  return HEATMAP_DATE.test(value);
}

export function diffDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

export function lastHeatmapDate(origin: string, length: number): string | null {
  if (!origin || length <= 0) return null;
  return addDays(origin, length - 1);
}

export function utcToday(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * 某个时刻落在某个时区的哪一天。
 *
 * 日合计是采集侧按它自己的日历分的桶，切窗必须用同一份日历 —— 拿 UTC 切，
 * 东八区 00:00 到 08:00 之间「今天」会被算成昨天，当天那格连着已经收到的
 * 数字一起被切掉，而 GitHub 那张图照常画到今天，两张图就错开一列。
 */
export function zonedDay(now: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
}

/** 53 周窗会填到本周六；今天之后的空格不能点、不能走键盘。 */
export function isHeatmapFuture(date: string, today = utcToday()): boolean {
  return date > today;
}

/**
 * 下一次增量从哪天问起。53 周窗口常常填到本周六，最后一格还在未来、
 * 数字是 0；今天的格子仍会涨，所以游标取「今天和窗尾较早的那个」。
 */
export function heatmapRefreshFrom(
  origin: string,
  length: number,
  today = utcToday(),
): string | null {
  const last = lastHeatmapDate(origin, length);
  if (!last) return null;
  if (today < origin) return origin;
  return today < last ? today : last;
}

export type HeatmapSlice = {
  /** 假 = 整份窗口；真 = 从 fromIndex 接到窗尾 */
  partial: boolean;
  fromIndex: number;
};

/**
 * 按客户端最后一天切窗口。返回的 fromIndex 含当天。
 *
 * since 缺、写坏、或已经不在窗口里，都按整份处理。
 */
export function sliceHeatmapWindow(
  origin: string,
  length: number,
  since?: string,
): HeatmapSlice {
  if (!since || !isHeatmapDate(since) || !origin || length <= 0) {
    return { partial: false, fromIndex: 0 };
  }
  const index = diffDays(origin, since);
  if (index < 0 || index >= length) return { partial: false, fromIndex: 0 };
  return { partial: true, fromIndex: index };
}

export function heatmapSliceFrom(origin: string, fromIndex: number): string {
  return addDays(origin, fromIndex);
}

/**
 * 把一段日序列并进本地窗口。
 *
 * 窗口原点往前滚时丢掉已经出窗的前缀；增量接在 `from` 上，长度以服务端
 * 这段尾巴为准。
 */
export function mergeHeatmapSeries(
  local: readonly number[] | undefined,
  localOrigin: string | undefined,
  incoming: {
    origin: string;
    from?: string;
    values: readonly number[];
    partial?: boolean;
  },
): { origin: string; values: number[] } {
  if (!incoming.partial || !local?.length || !localOrigin) {
    return { origin: incoming.origin, values: incoming.values.slice() };
  }

  const shift = diffDays(localOrigin, incoming.origin);
  const aligned =
    shift === 0 ? local.slice() : shift > 0 ? local.slice(shift) : padLeft(local, -shift);
  const from = incoming.from ?? incoming.origin;
  const fromIndex = Math.max(0, diffDays(incoming.origin, from));
  const length = fromIndex + incoming.values.length;
  const merged = Array.from({ length }, (_, index) => aligned[index] ?? 0);
  for (let index = 0; index < incoming.values.length; index += 1) {
    merged[fromIndex + index] = incoming.values[index] ?? 0;
  }
  return { origin: incoming.origin, values: merged };
}

function padLeft(values: readonly number[], count: number): number[] {
  return Array.from({ length: count }, () => 0).concat(values);
}

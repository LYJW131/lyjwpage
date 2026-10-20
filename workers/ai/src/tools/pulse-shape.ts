import { object } from "@shared/json";

type Columns = Record<string, unknown[]>;
type Row = Record<string, unknown> & { from: number; to: number };

// 原样的 pulse 是按列存的相对秒数组，编码道就上万字，整份视图在 MAX_CHARS_PER_VIEW 截断时听歌道根本到不了模型，
// 所以给模型前改成带绝对时间的行，只留有内容的时段，同一首歌、同一部片中间的短暂停合成一段。
// 各道合计放在最前的 totals、编码道时段放最后：截断只截 JSON 尾巴，忙的日子丢的也只是编码时段的末尾。
// 状态码是 shared/pulse-timeline.ts 里 LISTENING_STATES、WATCHING_STATES、GAMING_STATES 的下标。
export const MERGE_GAP_SEC = 600;
// 须与 shared/pulse-types.ts#isCodingDriverValue 同口径（site-status.test.ts 对照）：只有 agent 在跑的时段不算 lyjw 在写代码。
export const isDriverValue = (value: number) => value === 1 || value === 3;

function rows(columns: unknown, from: number, keys: string[]): Row[] {
  const source = object(columns) as Columns | undefined;
  const start = source?.startSec;
  if (!source || !Array.isArray(start) || ![...keys, "endSec"].every((key) => Array.isArray(source[key]) && source[key].length === start.length)) return [];
  return start.map((sec, index) => ({
    from: from + Number(sec) * 1000,
    to: from + Number(source.endSec[index]) * 1000,
    ...Object.fromEntries(keys.map((key) => [key, source[key][index]])),
  }));
}

// 起止跨过短空档（编码道逐段切得很碎，不合并一天能有两百多段），minutes 只算原始区间实际覆盖的时长；视图说明里告诉模型这一点。
function merge(list: Row[], same: (a: Row, b: Row) => boolean, gapSec = MERGE_GAP_SEC): Row[] {
  const out: (Row & { covered: number })[] = [];
  for (const row of list) {
    const last = out.at(-1);
    const span = Math.max(0, row.to - Math.max(row.from, last?.to ?? -Infinity));
    if (last && same(last, row) && row.from - last.to <= gapSec * 1000) {
      last.covered += span;
      last.to = Math.max(last.to, row.to);
    } else out.push({ ...row, covered: row.to - row.from });
  }
  return out.map(({ covered, ...row }) => ({ ...row, minutes: Math.round(covered / 60_000) }));
}

// 没有标题的在放时段（Emby 在放但条目没对上）各自保留，不和别的无标题时段合并。
const sameTitle = (a: Row, b: Row) => a.title !== null && a.title === b.title && a.subtitle === b.subtitle;

function stateLane(lane: Record<string, unknown>, from: number, keep: (state: number) => boolean, subtitle: string) {
  const played = rows(lane.segments, from, ["state", "title", "subtitle"])
    .filter((row) => keep(Number(row.state)))
    .map(({ from, to, title, subtitle }) => ({ from, to, title: title ?? null, subtitle: subtitle ?? null }));
  const rename = ({ subtitle: sub, ...row }: Row) => ({ ...row, [subtitle]: sub });
  return {
    spans: merge(played, sameTitle).map(rename),
    ...(lane.uncertain !== undefined && { inferredElsewhere: merge(rows(lane.uncertain, from, ["title", "subtitle", "marginSec"]), sameTitle).map(rename) }),
  };
}

export function pulseForModel(body: unknown): unknown {
  const data = object(object(body)?.data);
  const window = object(data?.window);
  const lanes = object(data?.lanes);
  if (!data || !lanes || typeof window?.from !== "number") return body;
  const from = window.from;
  const lane = (key: string) => object(lanes[key]) ?? {};
  return {
    ...(body as object),
    data: {
      generatedAt: data.generatedAt,
      window,
      totals: {
        listening: lane("listening").summary,
        watching: lane("watching").summary,
        gaming: lane("gaming").summary,
        coding: lane("coding").summary,
        tokens: lane("tokens").summary,
        charging: { currentPowerW: lane("charging").currentPowerW, ...object(lane("charging").summary) },
        activity: lane("activity").summary,
      },
      lanes: {
        listening: stateLane(lane("listening"), from, (state) => state === 2, "artist"),
        watching: stateLane(lane("watching"), from, (state) => state === 2, "episode"),
        gaming: stateLane(lane("gaming"), from, (state) => state === 2, "detail"),
        activity: { workouts: rows(lane("activity").workouts, from, ["activityType"]) },
        coding: {
          driverSpans: merge(rows(lane("coding").segments, from, ["value"]).filter((row) => isDriverValue(Number(row.value))).map(({ from, to }) => ({ from, to })), () => true),
        },
      },
    },
  };
}

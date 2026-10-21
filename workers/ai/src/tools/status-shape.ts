export const PAGE_SIZE = 20;

const IMAGE_KEY_WORDS = new Set(["cover", "covers", "artwork", "artworks", "image", "images", "icon", "icons", "thumbnail", "thumbnails", "thumb", "avatar", "avatars", "poster", "posters", "backdrop", "backdrops", "logo", "banner"]);
const IMAGE_URL = /^(?:data:image\/|\/img\/|(?:https?:\/\/|\/)[^\s?#]+\.(?:png|jpe?g|gif|webp|avif|svg|ico|heic)(?:[?#]|$))/i;

export function isImageField(key: string, value: unknown): boolean {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[\s_-]+/);
  return words.some((word) => IMAGE_KEY_WORDS.has(word)) || (typeof value === "string" && IMAGE_URL.test(value));
}

export const normalize = (text: string) => text.normalize("NFKC").toLowerCase();

export function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, child]) => !isImageField(key, child))
      .map(([key, child]) => [key, strip(child)]),
  );
}

function contains(value: unknown, needle: string): boolean {
  if (typeof value === "string") return normalize(value).includes(needle);
  if (typeof value === "number" || typeof value === "boolean") return String(value).includes(needle);
  if (Array.isArray(value)) return value.some((child) => contains(child, needle));
  if (value && typeof value === "object") return Object.values(value).some((child) => contains(child, needle));
  return false;
}

// 热力图类视图是 origin 起逐日的数值数组，模型按下标数日期既费步数又容易数错（实测关思考的 Flash 画「最近 7 天」错位一天），
// 所以附上按月合计 `<数组名>ByMonth`、最近 RECENT_DAYS 天的逐日值 `<数组名>LastDays`（键是日期）与现成的合计
// `<数组名>Sums`：关思考的 Flash 心算一长串数字会算错（实测「最近 7 天」少算 6 亿），给好的合计就不必它加。
// 「最近」从数据源的今天 `todayAtSource` 往回数：编码热力图补满 53 周，今天之后的格子是 0，不能按数组末尾算。
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const RECENT_DAYS = 14;

function lastDays(origin: string, values: number[]): Record<string, number> {
  const start = Date.parse(`${origin}T00:00:00Z`);
  const from = Math.max(0, values.length - RECENT_DAYS);
  return Object.fromEntries(values.slice(from).map((value, index) => [new Date(start + (from + index) * 86_400_000).toISOString().slice(0, 10), value]));
}

// 编码年度图的 `mix` 是稀疏的 [日偏移, models 下标, token 数, …]，模型照下标查名字容易错位，换成最近几天按日期、按模型展开的 `mixLastDays`。
function mixLastDays(origin: string, today: number, models: unknown[], mix: unknown[]): Record<string, Record<string, number>> {
  const start = Date.parse(`${origin}T00:00:00Z`);
  const out: Record<string, Record<string, number>> = {};
  for (const row of mix) {
    if (!Array.isArray(row) || typeof row[0] !== "number" || row[0] > today || row[0] <= today - RECENT_DAYS) continue;
    const day: Record<string, number> = {};
    for (let index = 1; index + 1 < row.length; index += 2) {
      const name = models[row[index]];
      if (typeof name === "string" && typeof row[index + 1] === "number") day[name] = row[index + 1];
    }
    out[new Date(start + row[0] * 86_400_000).toISOString().slice(0, 10)] = day;
  }
  return out;
}

function monthlyTotals(origin: string, values: number[]): Record<string, number> {
  const start = Date.parse(`${origin}T00:00:00Z`);
  const totals: Record<string, number> = {};
  values.forEach((value, index) => {
    const month = new Date(start + index * 86_400_000).toISOString().slice(0, 7);
    totals[month] = (totals[month] ?? 0) + value;
  });
  return totals;
}

function sums(values: number[]) {
  const total = (from: number) => values.slice(from).reduce((sum, value) => sum + value, 0);
  return { last7Days: total(-7), last30Days: total(-30), all: total(0) };
}

export function withMonthlyTotals(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withMonthlyTotals);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const start = typeof record.from === "string" && DAY.test(record.from) ? record.from : record.origin;
  const out = Object.fromEntries(Object.entries(record).map(([key, child]) => [key, withMonthlyTotals(child)]));
  if (typeof start !== "string" || !DAY.test(start)) return out;
  const today = typeof record.todayAtSource === "string" && DAY.test(record.todayAtSource)
    ? Math.round((Date.parse(`${record.todayAtSource}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000)
    : undefined;
  for (const [key, child] of Object.entries(record)) {
    if (Array.isArray(child) && child.length && child.every((item) => typeof item === "number")) {
      const past = today === undefined || today < 0 ? child : child.slice(0, today + 1);
      out[`${key}ByMonth`] = monthlyTotals(start, child);
      out[`${key}LastDays`] = lastDays(start, past);
      out[`${key}Sums`] = sums(past);
    }
  }
  if (today !== undefined && Array.isArray(record.models) && Array.isArray(record.mix)) {
    out.mixLastDays = mixLastDays(start, today, record.models, record.mix);
    delete out.mix;
  }
  return out;
}

const isScalarList = (value: unknown[]) => value.length > 0 && value.every((item) => item === null || typeof item !== "object");

export type PagedList = { path: string; total: number; before: number };

// 只处理最外层的数组（不在别的数组项里的）：搜到的条目整项保留，项里的子列表不再按 query 过滤或分页，
// 否则「游戏名匹配」会把这个游戏的奖杯列表筛空，嵌套列表也没法和外层共用同一个位置。
// 纯数值、字符串数组（逐日序列）整份保留：按下标对应日期，分页或筛选都会打乱对应关系，体积靠 MAX_CHARS_PER_VIEW 兜底。
export function collectLists(value: unknown, path: string, needle: string, lists: PagedList[]): unknown {
  if (Array.isArray(value) && isScalarList(value)) return value;
  if (Array.isArray(value)) {
    const items = needle ? value.filter((item) => contains(item, needle)) : value;
    if (needle || value.length > PAGE_SIZE) lists.push({ path: path || "(root)", total: items.length, before: value.length });
    return items;
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, collectLists(child, path ? `${path}.${key}` : key, needle, lists)]));
}

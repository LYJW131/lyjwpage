import { IMAGE_OBJECT_KEY, IMAGE_PATH_PREFIX } from "@shared/asset-url";
import { GOD_CHAT_CHART_SERIES, GOD_CHAT_VISUAL_KINDS, type GodChatVisualKind } from "@shared/god-chat";
import { visualLink } from "@/lib/html-preview";
import { parseImageSource } from "@/lib/image-proxy";

export type StatItem = { label: string; value: string; note?: string };
export type StatsVisual = { kind: "stats"; items: StatItem[]; summary?: StatItem & { tone?: "good" | "bad" } };
export type ChartVisual = {
  kind: "chart";
  type: "bar" | "column" | "line";
  title?: string;
  subtitle?: string;
  unit?: string;
  labels: string[];
  series: { name: string; values: number[] }[];
};
export type TimelineVisual = { kind: "timeline"; title?: string; items: { time: string; title: string; text?: string }[] };
export type MediaShape = "square" | "poster" | "wide";
export type MediaVisual = {
  kind: "media";
  title?: string;
  shape: MediaShape;
  items: { title: string; subtitle?: string; meta?: string; image?: string; url?: string }[];
};
export type ChatVisual = StatsVisual | ChartVisual | TimelineVisual | MediaVisual;

const LIMITS = {
  stats: 4,
  barLabels: 16,
  columnLabels: 24,
  linePoints: 60,
  timeline: 12,
  media: 12,
  short: 40,
  label: 80,
  title: 120,
  text: 400,
} as const;

const SHAPES: readonly MediaShape[] = ["square", "poster", "wide"];

type Raw = Record<string, unknown>;

const record = (value: unknown): Raw | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : null);

function text(value: unknown, max: number): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) value = String(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
}

function list<T>(value: unknown, min: number, max: number, item: (entry: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length < min || value.length > max) return null;
  const out: T[] = [];
  for (const entry of value) {
    const parsed = item(entry);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

const optional = <K extends string, V>(key: K, value: V | undefined) => (value === undefined ? {} : ({ [key]: value } as { [P in K]: V }));

function statItem(value: unknown): StatItem | null {
  const raw = record(value);
  const label = text(raw?.label, LIMITS.label);
  const shown = text(raw?.value, LIMITS.short);
  if (!raw || !label || !shown) return null;
  return { label, value: shown, ...optional("note", text(raw.note, LIMITS.title)) };
}

function stats(raw: Raw): StatsVisual | null {
  const items = list(raw.items, 1, LIMITS.stats, statItem);
  if (!items) return null;
  const summary = raw.summary === undefined ? undefined : statItem(raw.summary);
  if (summary === null) return null;
  const tone = record(raw.summary)?.tone;
  return {
    kind: "stats",
    items,
    ...optional("summary", summary && { ...summary, ...optional("tone", tone === "good" || tone === "bad" ? tone : undefined) }),
  };
}

function chart(raw: Raw): ChartVisual | null {
  const type = raw.type;
  if (type !== "bar" && type !== "column" && type !== "line") return null;
  const maxLabels = type === "bar" ? LIMITS.barLabels : type === "column" ? LIMITS.columnLabels : LIMITS.linePoints;
  const labels = list(raw.labels, type === "line" ? 2 : 1, maxLabels, (entry) => text(entry, LIMITS.label) ?? null);
  if (!labels) return null;
  const series = list(raw.series, 1, GOD_CHAT_CHART_SERIES, (entry) => {
    const item = record(entry);
    const name = text(item?.name, LIMITS.label);
    const values = list(item?.values, labels.length, labels.length, (v) =>
      typeof v === "number" && Number.isFinite(v) && (type === "line" || v >= 0) ? v : null,
    );
    return name && values ? { name, values } : null;
  });
  if (!series) return null;
  return {
    kind: "chart",
    type,
    labels,
    series,
    ...optional("title", text(raw.title, LIMITS.title)),
    ...optional("subtitle", text(raw.subtitle, LIMITS.title)),
    ...optional("unit", text(raw.unit, 12)),
  };
}

function timeline(raw: Raw): TimelineVisual | null {
  const items = list(raw.items, 1, LIMITS.timeline, (entry) => {
    const item = record(entry);
    const time = text(item?.time, LIMITS.short);
    const title = text(item?.title, LIMITS.title);
    return item && time && title ? { time, title, ...optional("text", text(item.text, LIMITS.text)) } : null;
  });
  return items ? { kind: "timeline", items, ...optional("title", text(raw.title, LIMITS.title)) } : null;
}

// 图片只认站点 /img/ 与图片代理放行的主机：模型（或联网读到的注入文本）能把对话内容拼进图片 URL，渲染即外带；
// 这些主机的访问日志不在攻击者手里。不合格的图片只丢图，条目照留。
export function visualImage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.startsWith(`${IMAGE_PATH_PREFIX}/`)) return IMAGE_OBJECT_KEY.test(value.slice(IMAGE_PATH_PREFIX.length + 1)) ? value : undefined;
  return parseImageSource(value) ? value : undefined;
}

function media(raw: Raw): MediaVisual | null {
  const items = list(raw.items, 1, LIMITS.media, (entry) => {
    const item = record(entry);
    const title = text(item?.title, LIMITS.title);
    if (!item || !title) return null;
    return {
      title,
      ...optional("subtitle", text(item.subtitle, LIMITS.title)),
      ...optional("meta", text(item.meta, LIMITS.short)),
      ...optional("image", visualImage(item.image)),
      ...optional("url", visualLink(item.url) ?? undefined),
    };
  });
  if (!items) return null;
  const shape = SHAPES.includes(raw.shape as MediaShape) ? (raw.shape as MediaShape) : "square";
  return { kind: "media", shape, items, ...optional("title", text(raw.title, LIMITS.title)) };
}

export function isVisualKind(value: string): value is GodChatVisualKind {
  return (GOD_CHAT_VISUAL_KINDS as string[]).includes(value);
}

export function parseVisual(kind: GodChatVisualKind, source: string): ChatVisual | null {
  let raw: Raw | null;
  try {
    raw = record(JSON.parse(source));
  } catch {
    return null;
  }
  if (!raw) return null;
  switch (kind) {
    case "stats":
      return stats(raw);
    case "chart":
      return chart(raw);
    case "timeline":
      return timeline(raw);
    case "media":
      return media(raw);
  }
}

export function niceTicks(min: number, max: number, target = 4): number[] {
  const low = Math.min(0, min);
  const high = max > low ? max : low + 1;
  const rough = (high - low) / target;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((candidate) => candidate >= rough) ?? 10 * power;
  const ticks: number[] = [];
  for (let tick = Math.floor(low / step) * step; tick < high + step - 1e-9; tick += step) ticks.push(Number(tick.toPrecision(12)));
  return ticks;
}

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const PLAIN = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function formatVisualNumber(value: number, unit?: string, compact = false): string {
  const number = compact && Math.abs(value) >= 10_000 ? COMPACT.format(value) : PLAIN.format(value);
  if (!unit) return number;
  return /^[%°]/.test(unit) ? `${number}${unit}` : `${number} ${unit}`;
}

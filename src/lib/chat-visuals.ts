import { IMAGE_OBJECT_KEY, IMAGE_PATH_PREFIX } from "@shared/asset-url";
import { checkGodChatVisual, type ChatVisual, type GodChatVisualKind } from "@shared/god-chat";
import { visualLink } from "@/lib/html-preview";
import { parseImageSource } from "@/lib/image-proxy";

// 图片只认站点 /img/ 与图片代理放行的主机：模型（或联网读到的注入文本）能把对话内容拼进图片 URL，渲染即外带；
// 这些主机的访问日志不在攻击者手里。不合格的图片只丢图，条目照留。
export function visualImage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.startsWith(`${IMAGE_PATH_PREFIX}/`)) return IMAGE_OBJECT_KEY.test(value.slice(IMAGE_PATH_PREFIX.length + 1)) ? value : undefined;
  return parseImageSource(value) ? value : undefined;
}

export function parseVisual(kind: GodChatVisualKind, source: string): ChatVisual | null {
  return checkGodChatVisual(kind, source, { image: visualImage, link: (value) => visualLink(value) ?? undefined }).visual;
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

// 流式时图示的 JSON 还没写完：从后往前在每个闭合的 } 或 ] 处截断、补齐还开着的括号再校验，取第一个过得去的。
// 时间线、数字卡片、媒体列表因此按写完的条目逐条长出来；图表要标签和数据都齐了才过得了校验。
const PARTIAL_TRIES = 40;

export function parsePartialVisual(kind: GodChatVisualKind, source: string): ChatVisual | null {
  const whole = parseVisual(kind, source);
  if (whole) return whole;
  const open: string[] = [];
  const cuts: { end: number; closers: string }[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{") open.push("}");
    else if (char === "[") open.push("]");
    else if (char === "}" || char === "]") {
      open.pop();
      cuts.push({ end: i + 1, closers: [...open].reverse().join("") });
    }
  }
  for (const { end, closers } of cuts.slice(-PARTIAL_TRIES).reverse()) {
    const visual = parseVisual(kind, source.slice(0, end) + closers);
    if (visual) return visual;
  }
  return null;
}

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

// 流式时图示的 JSON 还没写完：先把末尾写到一半的部分去掉、补齐还开着的括号再校验，画出已写完的字段；
// 不行再从后往前在每个闭合的 } 或 ] 处截断补齐，取第一个过得去的。
// 写到一半的部分指没写完的数字或字面量、只有键名或冒号的字段、多出的逗号。只去掉这半截、不退回上一个闭合点，
// 解析结果随输出只增不减：退回会让正在写的条目消失、写到值时再出现，来回闪。
// 正写到字符串值中间时补上引号收尾，条目里的文字跟着输出逐字长（流式的代码块末尾带一个换行，引号要补在它前面）；
// 图表的标签与媒体的图片、链接写到一半没有意义，这两种只画写完的字符串。
const PARTIAL_TRIES = 40;
const STREAM_TEXT_KINDS: ReadonlySet<GodChatVisualKind> = new Set(["stats", "timeline", "diagram"]);
const DANGLING_KEY = /"(?:[^"\\]|\\.)*"\s*:\s*$/;
const BARE_TOKEN = /[-\w.+]+$/;
const LONE_KEY = /[{,]\s*"(?:[^"\\]|\\.)*"$/;

type Scan = { closers: string; inString: boolean; escaped: boolean; stringStart: number; cuts: { end: number; closers: string }[] };

function scan(source: string): Scan {
  const open: string[] = [];
  const cuts: Scan["cuts"] = [];
  let inString = false;
  let escaped = false;
  let stringStart = -1;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
      stringStart = i;
    } else if (char === "{") open.push("}");
    else if (char === "[") open.push("]");
    else if (char === "}" || char === "]") {
      open.pop();
      cuts.push({ end: i + 1, closers: [...open].reverse().join("") });
    }
  }
  return { closers: [...open].reverse().join(""), inString, escaped, stringStart, cuts };
}

// 对象里紧跟 { 或 , 的完整字符串只可能是还没写冒号的键名；数组里的同样写法是写完的值，留着。
function settledPrefix(source: string, { inString, stringStart }: Scan): string {
  let rest = inString ? source.slice(0, stringStart).trimEnd() : source.trimEnd().replace(BARE_TOKEN, "").trimEnd();
  for (;;) {
    let next = rest.replace(DANGLING_KEY, "").trimEnd().replace(/,$/, "").trimEnd();
    const key = LONE_KEY.exec(next);
    if (key && scan(next.slice(0, key.index + 1)).closers.startsWith("}")) next = next.slice(0, key.index + 1).trimEnd();
    if (next === rest) return rest;
    rest = next;
  }
}

export function parsePartialVisual(kind: GodChatVisualKind, source: string): ChatVisual | null {
  const whole = parseVisual(kind, source);
  if (whole) return whole;
  const state = scan(source);
  if (state.inString && !state.escaped && STREAM_TEXT_KINDS.has(kind)) {
    const visual = parseVisual(kind, `${source.trimEnd()}"`);
    if (visual) return visual;
  }
  const settled = settledPrefix(source, state);
  const tail = scan(settled);
  if (!tail.inString) {
    const visual = parseVisual(kind, settled + tail.closers);
    if (visual) return visual;
  }
  for (const { end, closers } of state.cuts.slice(-PARTIAL_TRIES).reverse()) {
    const visual = parseVisual(kind, source.slice(0, end) + closers);
    if (visual) return visual;
  }
  return null;
}

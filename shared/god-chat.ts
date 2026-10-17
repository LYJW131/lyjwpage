export { GOD_CHAT_PATH, GOD_CHAT_USAGE_PATH } from "./ai-paths";
import type { StatusViewKey } from "@shared/status-views";
import { BUILD_TOKEN_MAX_CHARS, type BuildProposal } from "./build-routine";
import type { GodChatTimeInput } from "./chat-time";
import { object } from "./json";

import { GOD_CHAT_RETIRED_TIERS, isGodChatServedTier, type GodChatEffort, type GodChatRetiredTier, type GodChatRoute, type GodChatServedTier, type GodChatTier } from "./god-chat-tiers";

// 卡片渲染 Turnstile 时带上，Worker 校验 siteverify 回来的 action 与之相同。
export const GOD_CHAT_TURNSTILE_ACTION = "god-chat";
// 验过人后 Worker 发的通行证有效期，期内不再要新的 Turnstile token。有意取天级：人机验证只为挡脚本，频繁重验伤体验。
export const GOD_CHAT_PASS_TTL_MS = 7 * 24 * 60 * 60_000;
export const GOD_CHAT_PASS_PATTERN = /^\d{13}\.[\w-]{20,100}$/;

// 公开端点直接花 API 额度：这几项上限共同限定单次请求的最大花费，放宽前先算账。
export const GOD_CHAT_LIMITS = {
  maxMessages: 20,
  maxMessageChars: 2000,
  maxReplyChars: 4000,
  maxTotalChars: 16000,
  maxPlanHistoryChars: BUILD_TOKEN_MAX_CHARS,
  maxToolRounds: 3,
  // 一问涉及好几样东西时模型会在同一轮并发搜好几条（问几部番就一部一条），额度要容得下一批多条再补搜一轮，否则模型只能说次数用完。
  maxWebSearches: 10,
} as const;

// show_card 能画的卡片：模型只选卡片名，卡片由浏览器按这里登记的状态视图读公开数据自己画，Worker 也读同一组视图回给模型。
// 「此刻」和「最近」各是一张卡：问此刻只画此刻，免得把历史一起端出来。浏览器可以额外借读别的视图补图，但不得靠它才画得出来。
export const GOD_CHAT_CARD_VIEWS = {
  nowListening: ["nowListening"],
  listening: ["listening"],
  nowWatching: ["nowWatching"],
  watching: ["watching"],
  playingNow: ["playingNow"],
  playing: ["playing"],
  activity: ["activity"],
  workouts: ["workouts"],
} as const satisfies Record<string, readonly StatusViewKey[]>;

export type GodChatCard = keyof typeof GOD_CHAT_CARD_VIEWS;
export const GOD_CHAT_CARDS = Object.keys(GOD_CHAT_CARD_VIEWS) as GodChatCard[];

export function isGodChatCard(value: unknown): value is GodChatCard {
  return GOD_CHAT_CARDS.includes(value as GodChatCard);
}

// 首页的示例问题。对话第一条与某条原文一字不差时（点选或照打都算），Worker 跳过 Clef，按 choice 定档，
// 并在第一次请求前替模型跑好 prefetch 里的工具调用，模型拿着结果直接作答。lyjw 要求示例用中文，是「界面文案英文」的例外；
// 每条须在 14 个汉字宽以内：桌面两列等宽格放得下，换题时按钮尺寸不变。
// choice 是 workers/ai/src/chat/router.ts#CLEF_CHOICES 的键，prefetch 须是对应工具的合法输入，两者由 workers/ai 的测试核对。
// show 是给模型的英文提示，点名这一题用哪种图示或卡片：示例是访客第一眼看到的能力展示，要让富渲染稳定出现。
export type GodChatPresetCall =
  | { name: "get_site_status"; input: { views: StatusViewKey[] } }
  | { name: "read_project_doc"; input: { doc: string } }
  | { name: "web_search"; input: { query: string; category: "web" | "news" | "papers" } };
export type GodChatPreset = { text: string; choice: string; prefetch?: GodChatPresetCall[]; show?: string };

const status = (...views: StatusViewKey[]): GodChatPresetCall[] => [{ name: "get_site_status", input: { views } }];
const doc = (key: string): GodChatPresetCall[] => [{ name: "read_project_doc", input: { doc: key } }];
const search = (query: string, category: "web" | "news"): GodChatPresetCall[] => [{ name: "web_search", input: { query, category } }];

// 首屏四条各对应一类能力：实时状态、读设计文档、网页搜索、设计会话。
export const GOD_CHAT_PRESETS: readonly GodChatPreset[] = [
  { text: "LYJW 现在在忙什么？", choice: "flash", prefetch: status("desktop", "codingNow", "nowListening", "playingNow"), show: "If something is playing, put its live card in with show_card; otherwise sum up the moment in a stats visual." },
  { text: "这个网站是怎么搭起来的？", choice: "flash", prefetch: doc("overview"), show: "Draw the architecture as a diagram visual: layers for the reporters, the Workers and the browser, with edges for how data flows." },
  { text: "这周 AI 圈有什么大新闻？", choice: "think", prefetch: search("biggest AI news this week", "news"), show: "Lay out the main stories as a timeline visual, newest last, then add a line on what matters most." },
  { text: "我想给这个网站提个改进", choice: "design" },
  { text: "LYJW 最近在听什么歌？", choice: "flash", prefetch: status("nowListening", "listening"), show: "Show the recent listening card with show_card." },
  { text: "首页的实时数据从哪来？", choice: "flash", prefetch: doc("liveStatus"), show: "Draw the path from devices to the page as a diagram visual, one layer per hop." },
  { text: "今天科技圈有什么新鲜事？", choice: "think", prefetch: search("tech news today", "news"), show: "Lay out the stories as a timeline visual." },
  { text: "LYJW 最近在玩什么游戏？", choice: "flash", prefetch: status("playingNow", "playing", "questNow"), show: "Show the recent games card with show_card." },
  { text: "这个网站用了哪些技术？", choice: "flash", prefetch: doc("overview"), show: "Draw the stack as a diagram visual with one layer each for the front end, the Workers, storage and the reporters." },
  { text: "比较一下最新的几款大模型", choice: "think", prefetch: search("latest frontier AI model releases compared", "news"), show: "Compare the models in a chart visual (for example price per million output tokens) and give the verdict in prose." },
  { text: "LYJW 最近在追什么番？", choice: "flash", prefetch: status("nowWatching", "watching"), show: "Show the recent watching card with show_card." },
  { text: "网站最近的提交改了什么？", choice: "flash", prefetch: status("githubRepo"), show: "Lay out the latest commits as a timeline visual." },
  { text: "LYJW 今天运动了吗？", choice: "flash", prefetch: status("activity", "workouts"), show: "Show the activity card with show_card." },
  { text: "LYJW 用 AI 写了多少代码？", choice: "flash", prefetch: status("coding", "codingNow"), show: "Put the headline totals in a stats visual and the daily token trend in a chart visual." },
];

// 回复里的原生图示：模型在正文里写一个以图示名为语言标记的代码块，内容是 JSON，浏览器按 src/lib/chat-visuals.ts 校验后用站点组件画。
// 提示词直接印这些例子，测试保证每个例子都能过校验，两边不会各说各的。
export const GOD_CHAT_VISUAL_EXAMPLES = {
  stats: {
    items: [
      { label: "5% a year", value: "$166K", note: "after 30 years" },
      { label: "8% a year", value: "$282K", note: "after 30 years" },
    ],
    summary: { label: "Difference", value: "+$116K", note: "same $72K deposited", tone: "good" },
  },
  chart: {
    type: "bar",
    title: "PS5 play time",
    subtitle: "Last 30 days",
    unit: "h",
    labels: ["Astro Bot", "Gran Turismo 7"],
    series: [{ name: "Hours", values: [12.5, 7] }],
  },
  timeline: {
    title: "2013 to 2019",
    items: [
      { time: "2013", title: "React released", text: "Declarative components and a virtual DOM." },
      { time: "2019", title: "Hooks", text: "State and effects without classes." },
    ],
  },
  media: {
    shape: "square",
    items: [{ title: "Song or album", subtitle: "Artist", meta: "2h ago", image: "https://is1-ssl.mzstatic.com/image/thumb/a/b/{w}x{h}bb.jpg", url: "https://music.apple.com/" }],
  },
  diagram: {
    title: "Request path",
    layers: [
      { label: "Client", nodes: [{ id: "web", label: "Browser" }, { id: "app", label: "Mobile app" }] },
      { label: "Edge", nodes: [{ id: "api", label: "API", note: "auth and rate limits" }] },
      { label: "Storage", nodes: [{ id: "db", label: "Database" }, { id: "cache", label: "Cache" }] },
    ],
    edges: [
      { from: "web", to: "api", label: "HTTPS" },
      { from: "app", to: "api" },
      { from: "api", to: "db" },
      { from: "api", to: "cache" },
    ],
  },
} as const;

export type GodChatVisualKind = keyof typeof GOD_CHAT_VISUAL_EXAMPLES;
export const GOD_CHAT_VISUAL_KINDS = Object.keys(GOD_CHAT_VISUAL_EXAMPLES) as GodChatVisualKind[];
export const GOD_CHAT_CHART_SERIES = 4;
// 校验与提示词共用这组上限。超出的部分按 OpenUI 的做法丢掉或截断、其余照画（docs/references.md「OpenUI」）：过长的文字截断加省略号，
// 过多的条目只留前面的，不合格的条目、序列、节点只丢那一项；只有剩下的撑不起一张图（结构不对、条目不够）时才整块退回成代码。
// 提示词仍把上限原样告诉模型，截掉的内容访客看不到。
export const GOD_CHAT_VISUAL_LIMITS = {
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
  unit: 12,
  diagramLayers: 6,
  diagramNodes: 4,
  diagramEdges: 16,
} as const;

export function isGodChatVisualKind(value: string): value is GodChatVisualKind {
  return (GOD_CHAT_VISUAL_KINDS as string[]).includes(value);
}

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
export type DiagramNode = { id: string; label: string; note?: string };
export type DiagramVisual = {
  kind: "diagram";
  title?: string;
  layers: { label?: string; nodes: DiagramNode[] }[];
  edges: { from: string; to: string; label?: string }[];
};
export type ChatVisual = StatsVisual | ChartVisual | TimelineVisual | MediaVisual | DiagramVisual;

// 图片与链接只丢不拒：不合格的只去掉那一项，条目照留，所以整块过不过校验与它们无关。
// 默认全丢：只判断过不过校验时用不着它们，要画图的一方传入自己的放行规则。
export type VisualSanitizers = { image: (value: unknown) => string | undefined; link: (value: unknown) => string | undefined };
const DROP_ALL: VisualSanitizers = { image: () => undefined, link: () => undefined };

export type VisualCheck = { visual: ChatVisual; error?: undefined } | { visual: null; error: "json" | "shape" };

type Raw = Record<string, unknown>;
const LIMITS = GOD_CHAT_VISUAL_LIMITS;
const SHAPES: readonly MediaShape[] = ["square", "poster", "wide"];

function text(value: unknown, max: number): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) value = String(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const chars = [...trimmed];
  return chars.length <= max ? trimmed : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

function list<T>(value: unknown, min: number, max: number, item: (entry: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const out: T[] = [];
  for (const entry of value) {
    if (out.length === max) break;
    const parsed = item(entry);
    if (parsed !== null) out.push(parsed);
  }
  return out.length >= min ? out : null;
}

const optional = <K extends string, V>(key: K, value: V | undefined) => (value === undefined ? {} : ({ [key]: value } as { [P in K]: V }));

function statItem(value: unknown): StatItem | null {
  const raw = object(value);
  const label = text(raw?.label, LIMITS.label);
  const shown = text(raw?.value, LIMITS.short);
  if (!raw || !label || !shown) return null;
  return { label, value: shown, ...optional("note", text(raw.note, LIMITS.title)) };
}

function stats(raw: Raw): StatsVisual | null {
  const items = list(raw.items, 1, LIMITS.stats, statItem);
  if (!items) return null;
  const summary = raw.summary === undefined ? undefined : statItem(raw.summary) ?? undefined;
  const tone = object(raw.summary)?.tone;
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
  // 标签与每个序列按下标对齐：丢掉一个标签会把后面的数全挪一格，所以标签有一个不合格就整张不画，多出的只截尾。
  if (!Array.isArray(raw.labels)) return null;
  const labels = raw.labels.slice(0, maxLabels).map((entry) => text(entry, LIMITS.label));
  if (labels.length < (type === "line" ? 2 : 1) || labels.some((label) => label === undefined)) return null;
  const series = list(raw.series, 1, GOD_CHAT_CHART_SERIES, (entry) => {
    const item = object(entry);
    const name = text(item?.name, LIMITS.label);
    if (!name || !Array.isArray(item?.values) || item.values.length < labels.length) return null;
    const values = item.values.slice(0, labels.length);
    return values.every((v) => typeof v === "number" && Number.isFinite(v) && (type === "line" || v >= 0)) ? { name, values: values as number[] } : null;
  });
  if (!series) return null;
  return {
    kind: "chart",
    type,
    labels: labels as string[],
    series,
    ...optional("title", text(raw.title, LIMITS.title)),
    ...optional("subtitle", text(raw.subtitle, LIMITS.title)),
    ...optional("unit", text(raw.unit, LIMITS.unit)),
  };
}

function timeline(raw: Raw): TimelineVisual | null {
  const items = list(raw.items, 1, LIMITS.timeline, (entry) => {
    const item = object(entry);
    const time = text(item?.time, LIMITS.short);
    const title = text(item?.title, LIMITS.title);
    return item && time && title ? { time, title, ...optional("text", text(item.text, LIMITS.text)) } : null;
  });
  return items ? { kind: "timeline", items, ...optional("title", text(raw.title, LIMITS.title)) } : null;
}

function media(raw: Raw, sanitize: VisualSanitizers): MediaVisual | null {
  const items = list(raw.items, 1, LIMITS.media, (entry) => {
    const item = object(entry);
    const title = text(item?.title, LIMITS.title);
    if (!item || !title) return null;
    return {
      title,
      ...optional("subtitle", text(item.subtitle, LIMITS.title)),
      ...optional("meta", text(item.meta, LIMITS.short)),
      ...optional("image", sanitize.image(item.image)),
      ...optional("url", sanitize.link(item.url)),
    };
  });
  if (!items) return null;
  const shape = SHAPES.includes(raw.shape as MediaShape) ? (raw.shape as MediaShape) : "square";
  return { kind: "media", shape, items, ...optional("title", text(raw.title, LIMITS.title)) };
}

// 连线只接相邻两层：跨层的线会穿过中间那层的方框，渲染不画绕行。
// 画不了的连线（同层、跨层、指向不存在的节点）只丢那一条，不拒整张图：模型偶尔连一条同层线，整张退回成 JSON 代码块代价太大。
function diagram(raw: Raw): DiagramVisual | null {
  const seen = new Set<string>();
  const layers = list(raw.layers, 1, LIMITS.diagramLayers, (entry) => {
    const layer = object(entry);
    const nodes = list(layer?.nodes, 1, LIMITS.diagramNodes, (value) => {
      const node = object(value);
      const id = text(node?.id, LIMITS.short);
      const label = text(node?.label, LIMITS.short);
      if (!node || !id || !label || seen.has(id)) return null;
      seen.add(id);
      return { id, label, ...optional("note", text(node.note, LIMITS.label)) };
    });
    return layer && nodes ? { nodes, ...optional("label", text(layer.label, LIMITS.short)) } : null;
  });
  if (!layers) return null;
  // 层深按丢掉坏层之后的顺序算：画出来相邻的两层，连线就该留着。
  const depth = new Map(layers.flatMap((layer, index) => layer.nodes.map((node) => [node.id, index] as const)));
  const edges = list(raw.edges ?? [], 0, LIMITS.diagramEdges, (entry) => {
    const edge = object(entry);
    const from = text(edge?.from, LIMITS.short);
    const to = text(edge?.to, LIMITS.short);
    const gap = from !== undefined && to !== undefined ? Math.abs((depth.get(from) ?? NaN) - (depth.get(to) ?? NaN)) : NaN;
    if (!edge || !from || !to || gap !== 1) return null;
    return { from, to, ...optional("label", text(edge.label, LIMITS.short)) };
  });
  return edges ? { kind: "diagram", layers, edges, ...optional("title", text(raw.title, LIMITS.title)) } : null;
}

const PARSERS: Record<GodChatVisualKind, (raw: Raw, sanitize: VisualSanitizers) => ChatVisual | null> = {
  stats,
  chart,
  timeline,
  media,
  diagram,
};

export function checkGodChatVisual(kind: GodChatVisualKind, source: string, sanitize: VisualSanitizers = DROP_ALL): VisualCheck {
  let raw: Raw | null;
  try {
    raw = object(JSON.parse(source));
  } catch {
    return { visual: null, error: "json" };
  }
  const visual = raw && PARSERS[kind](raw, sanitize);
  return visual ? { visual } : { visual: null, error: "shape" };
}
export const GOD_CHAT_HTML_THEME_VARS = ["--fg", "--muted", "--line", "--surface", "--accent", "--red", "--orange", "--yellow", "--green", "--blue", "--violet"] as const;

export function readGodChatRoute(tier: unknown, downgradedFrom?: unknown): { tier: GodChatServedTier | null; downgradedFrom?: GodChatServedTier } | undefined {
  if (tier === null) return { tier: null };
  if (!isGodChatServedTier(tier)) return undefined;
  const from = isGodChatServedTier(downgradedFrom) ? downgradedFrom : undefined;
  return { tier, ...(from && { downgradedFrom: from }) };
}

// 浏览器只回传文字，工具调用的原始结果不回传；trace 记下那条回复由哪一档作答、查过哪些视图与项目文档、搜了几次、
// 是否由拒答兜底的模型代答。Worker 据此告诉模型那条回复当时用过工具，否则它会以为自己当时是在编。
// trace 由 Worker 在回复结束时随 seal 事件下发，浏览器原样带回；只收枚举与计数，不收任何自由文本（搜索词、文档章节名不回传）。
// docs 是 read_project_doc 的文档键，design / plan 标记规划工具，cards 是那条回复给访客画过的卡片。
export type GodChatTrace = {
  tier?: GodChatServedTier | GodChatRetiredTier;
  // 每轮原样重放消息级 effort，切换强度不能重写已缓存的历史前缀。
  effort?: GodChatEffort;
  views?: string[];
  docs?: string[];
  searches?: number;
  fallback?: true;
  design?: true;
  plan?: true;
  cards?: GodChatCard[];
};
// seal 是 Worker 给「访客消息 + 这条回复 + trace + planToken」整对盖的章，只在助手消息上；历史里章对不上的一问一答整对丢掉。
// time 只挂在访客消息上，是该条消息发出时的时钟（ISO 瞬间 + 浏览器时区名），随消息在历史里走；签名外，新一轮请求覆盖最新一条的值。
export type GodChatMessage = { role: "user" | "assistant"; content: string; trace?: GodChatTrace; seal?: string; planToken?: string; time?: GodChatTimeInput };
export type GodChatDesign = { token: string; expiresAt: number; remaining: number };

export type GodChatSource = { url: string; title: string };

// ask 是设计会话里规划者让访客做选择的题目：浏览器画成可点的选项，访客的回答作为下一条消息发回，
// 题目本身不进历史签章，回答里带着题目原文，模型据此接上。
export type GodChatQuestion = { header: string; question: string; multiSelect: boolean; options: { label: string; description: string }[] };
export const GOD_CHAT_ASK_LIMITS = { questions: 3, minOptions: 2, options: 4, headerChars: 24, questionChars: 200, labelChars: 60, descriptionChars: 300 } as const;

export function parseQuestions(value: unknown): GodChatQuestion[] | null {
  const limits = GOD_CHAT_ASK_LIMITS;
  const text = (item: unknown, max: number) => typeof item === "string" && item.trim() && item.length <= max ? item.trim() : null;
  if (!Array.isArray(value) || !value.length || value.length > limits.questions) return null;
  const questions: GodChatQuestion[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const { header, question, multiSelect, options } = entry as Record<string, unknown>;
    const cleanHeader = text(header, limits.headerChars);
    const cleanQuestion = text(question, limits.questionChars);
    if (!cleanHeader || !cleanQuestion || typeof multiSelect !== "boolean" || !Array.isArray(options) || options.length < limits.minOptions || options.length > limits.options) return null;
    const cleanOptions: GodChatQuestion["options"] = [];
    for (const option of options) {
      if (!option || typeof option !== "object") return null;
      const label = text((option as Record<string, unknown>).label, limits.labelChars);
      const description = (option as Record<string, unknown>).description;
      if (!label || typeof description !== "string" || description.length > limits.descriptionChars) return null;
      cleanOptions.push({ label, description: description.trim() });
    }
    if (new Set(cleanOptions.map((option) => option.label)).size !== cleanOptions.length) return null;
    questions.push({ header: cleanHeader, question: cleanQuestion, multiSelect, options: cleanOptions });
  }
  return questions;
}

// 响应体是 NDJSON，每行一个事件；首行总是 route（refuse 时 tier 为 null），views 是 get_site_status 读取的视图键。
// doc 是 read_project_doc 的一次读取：doc 为文档键，path 为仓库内路径（别的仓库带 owner/repo 前缀），url 为 GitHub 页面，section 为实际读到的章节标题（没读章节或没匹配上时缺省）。
// design 和 plan 的 token 各自签名；计划 token 同时进该轮历史签章，不能移到另一条回复里。
// card 是 show_card 要画的卡片，画在回复里收到这一行时正文已到的位置；同一条回复里同一张卡片只发一次。
// thinking 是模型思考的摘要（不是原文），只给界面在等正文时显示，不进对话历史；分几轮想时轮与轮之间补一个空行。
// step 是设计会话里规划者在沙盒中的一步（搜代码、跑命令）的一行英文说明，只给界面显示进度，不进对话历史。
// served 只在给出最终答案的那一轮由 Anthropic 的拒答兜底模型答成（没被拒）时出现，回复末尾一次，model 是那个模型的 id。
export type GodChatEvent =
  | { type: "route"; route: GodChatRoute; tier: GodChatServedTier | null; downgradedFrom?: GodChatTier }
  | { type: "served"; model: string }
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | ({ type: "design" } & GodChatDesign)
  | ({ type: "plan" } & BuildProposal)
  | { type: "ask"; questions: GodChatQuestion[] }
  | { type: "card"; card: GodChatCard }
  | { type: "tool"; views: string[] }
  | { type: "doc"; doc: string; path: string; url: string; section?: string }
  | { type: "search"; query: string }
  | { type: "step"; text: string }
  | { type: "sources"; sources: GodChatSource[] }
  | { type: "seal"; seal: string; trace?: GodChatTrace; planToken?: string }
  | { type: "pass"; pass: string; expiresAt: number };

// resume：设计会话里重新取回访客断线时错过的那条回复，messages 截到访客那条为止；不扣设计轮数。
export type GodChatRequest = { messages: GodChatMessage[]; turnstileToken?: string; humanPass?: string; designToken?: string; resume?: true; time?: GodChatTimeInput };

// 访客自己的话超长就拒；模型的旧回复只截断，超出总量从最早的消息丢起，长回答不能让后续对话发不出去。
// 浏览器发送前先过一遍，Worker 收到后再过一遍。
export function clipReply(content: string): string {
  return content.length > GOD_CHAT_LIMITS.maxReplyChars ? `${content.slice(0, GOD_CHAT_LIMITS.maxReplyChars)}…` : content;
}

export function fitHistory(messages: GodChatMessage[]): GodChatMessage[] {
  const clipped = messages
    .slice(-GOD_CHAT_LIMITS.maxMessages)
    .map((m) => (m.role === "assistant" ? { ...m, content: clipReply(m.content) } : m));
  let total = clipped.reduce((sum, m) => sum + m.content.length, 0);
  let planTotal = clipped.reduce((sum, m) => sum + (m.planToken?.length ?? 0), 0);
  while (clipped.length > 1 && (total > GOD_CHAT_LIMITS.maxTotalChars || planTotal > GOD_CHAT_LIMITS.maxPlanHistoryChars)) {
    const removed = clipped.shift()!;
    total -= removed.content.length;
    planTotal -= removed.planToken?.length ?? 0;
  }
  while (clipped.length && clipped[0].role !== "user") clipped.shift();
  return clipped;
}

const shortStrings = (value: unknown, max: number, len: number): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= len).slice(0, max) : [];

export function normalizeTrace(value: unknown): GodChatTrace | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const effort = raw.effort === "low" || raw.effort === "medium" || raw.effort === "high" ? raw.effort : undefined;
  const views = shortStrings(raw.views, 12, 40).filter((v) => /^[A-Za-z]+$/.test(v));
  const docs = shortStrings(raw.docs, 8, 40).filter((v) => /^[A-Za-z]+$/.test(v));
  const searches = Number.isInteger(raw.searches) ? Math.min(raw.searches as number, GOD_CHAT_LIMITS.maxWebSearches) : 0;
  const cards = Array.isArray(raw.cards) ? [...new Set(raw.cards.filter(isGodChatCard))] : [];
  const trace: GodChatTrace = {
    ...((isGodChatServedTier(raw.tier) || GOD_CHAT_RETIRED_TIERS.includes(raw.tier as GodChatRetiredTier)) && { tier: raw.tier as GodChatServedTier | GodChatRetiredTier }),
    ...(effort && { effort }),
    ...(views.length && { views }),
    ...(docs.length && { docs }),
    ...(searches > 0 && { searches }),
    ...(raw.fallback === true && { fallback: true as const }),
    ...(raw.design === true && { design: true as const }),
    ...(raw.plan === true && { plan: true as const }),
    ...(cards.length && { cards }),
  };
  return Object.keys(trace).length ? trace : undefined;
}

const parseTime = (value: unknown): GodChatTimeInput | undefined => {
  if (value === undefined) return undefined;
  const raw = object(value);
  if (!raw) return null as never;
  const { iso, zone } = raw;
  if (typeof iso !== "string" || !iso || iso.length > 64) return null as never;
  if (Number.isNaN(new Date(iso).getTime())) return null as never;
  if (zone !== undefined && (typeof zone !== "string" || zone.length > 64)) return null as never;
  return { iso, ...(typeof zone === "string" && zone ? { zone } : {}) };
};

export function parseGodChatRequest(body: unknown): GodChatRequest | null {
  if (!body || typeof body !== "object") return null;
  const { messages, turnstileToken, humanPass, designToken, resume, time } = body as Record<string, unknown>;
  const cleanTime = parseTime(time);
  if (time !== undefined && !cleanTime) return null;
  if (turnstileToken !== undefined && (typeof turnstileToken !== "string" || !turnstileToken || turnstileToken.length > 2048)) return null;
  if (humanPass !== undefined && (typeof humanPass !== "string" || !GOD_CHAT_PASS_PATTERN.test(humanPass))) return null;
  if (turnstileToken === undefined && humanPass === undefined) return null;
  if (designToken !== undefined && (typeof designToken !== "string" || !/^[\w-]+\.[\w-]+$/.test(designToken) || designToken.length > 2048)) return null;
  if (resume !== undefined && (resume !== true || designToken === undefined)) return null;
  if (!Array.isArray(messages) || messages.length === 0) return null;

  const parsed: GodChatMessage[] = [];
  for (const message of messages.slice(-GOD_CHAT_LIMITS.maxMessages)) {
    if (!message || typeof message !== "object") return null;
    const { role, content, trace, seal, planToken, time } = message as Record<string, unknown>;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    const text = content.trim();
    if (!text) return null;
    if (role === "user" && text.length > GOD_CHAT_LIMITS.maxMessageChars) return null;
    const cleanTrace = role === "assistant" ? normalizeTrace(trace) : undefined;
    const cleanSeal = role === "assistant" && typeof seal === "string" && /^[\w-]{20,100}$/.test(seal) ? seal : undefined;
    const cleanPlan = role === "assistant" && typeof planToken === "string" && planToken.length <= BUILD_TOKEN_MAX_CHARS && /^[\w-]+\.[\w-]+$/.test(planToken) ? planToken : undefined;
    // time 只挂在访客消息上、随历史逐条往返；非法值的整段请求退回，不让伪造时钟进来。
    const cleanTime = role === "user" && time !== undefined ? parseTime(time) : undefined;
    if (role === "user" && time !== undefined && !cleanTime) return null;
    parsed.push({ role, content: text, ...(cleanTrace && { trace: cleanTrace }), ...(cleanSeal && { seal: cleanSeal }), ...(cleanPlan && { planToken: cleanPlan }), ...(cleanTime && { time: cleanTime }) });
  }
  const fitted = fitHistory(parsed);
  if (!fitted.length || fitted[fitted.length - 1].role !== "user") return null;
  // 顶层 time 兜底最新一条：旧会话的访客气泡可能没存 time；逐条保留的那部分在循环里已带上，这里不覆盖它。
  if (cleanTime) fitted[fitted.length - 1] = { ...fitted[fitted.length - 1], time: fitted[fitted.length - 1].time ?? cleanTime };
  return { messages: fitted, ...(typeof turnstileToken === "string" && { turnstileToken }), ...(typeof humanPass === "string" && { humanPass }), ...(typeof designToken === "string" && { designToken }), ...(resume === true && { resume: true as const }), ...(cleanTime && { time: cleanTime }) };
}

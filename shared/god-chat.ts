import type { StatusViewKey } from "@/lib/status-views";

import { isGodChatTier, type GodChatEffort, type GodChatRoute, type GodChatTier } from "./god-chat-tiers";

export const GOD_CHAT_PATH = "/api/chat";
export const GOD_CHAT_USAGE_PATH = "/api/chat/usage";
// 卡片渲染 Turnstile 时带上，Worker 校验 siteverify 回来的 action 与之相同。
export const GOD_CHAT_TURNSTILE_ACTION = "god-chat";

// 公开端点直接花 API 额度：这几项上限共同限定单次请求的最大花费，放宽前先算账。
export const GOD_CHAT_LIMITS = {
  maxMessages: 20,
  maxMessageChars: 2000,
  maxReplyChars: 4000,
  maxTotalChars: 16000,
  maxToolRounds: 3,
  maxWebSearches: 2,
} as const;

// show_card 能画的卡片：模型只选卡片名，卡片由浏览器按这里登记的状态视图读公开数据自己画，Worker 也读同一组视图回给模型。
export const GOD_CHAT_CARD_VIEWS = {
  music: ["nowListening", "listening"],
  watching: ["nowWatching", "watching"],
  gaming: ["playingNow", "playing"],
  fitness: ["activity", "workouts"],
} as const satisfies Record<string, readonly StatusViewKey[]>;

export type GodChatCard = keyof typeof GOD_CHAT_CARD_VIEWS;
export const GOD_CHAT_CARDS = Object.keys(GOD_CHAT_CARD_VIEWS) as GodChatCard[];

export function isGodChatCard(value: unknown): value is GodChatCard {
  return GOD_CHAT_CARDS.includes(value as GodChatCard);
}

// 浏览器只回传文字，工具调用的原始结果不回传；trace 记下那条回复由哪一档作答、查过哪些视图与项目文档、搜了几次、
// 是否由拒答兜底的模型代答。Worker 据此告诉模型那条回复当时用过工具，否则它会以为自己当时是在编。
// trace 由 Worker 在回复结束时随 seal 事件下发，浏览器原样带回；只收枚举与计数，不收任何自由文本（搜索词、文档章节名不回传）。
// docs 是 read_project_doc 的文档键，issue 表示那条回复起草过 issue，cards 是那条回复给访客画过的卡片。
export type GodChatTrace = {
  tier?: GodChatTier;
  // 每轮原样重放消息级 effort，切换强度不能重写已缓存的历史前缀。
  effort?: GodChatEffort;
  views?: string[];
  docs?: string[];
  searches?: number;
  fallback?: true;
  issue?: true;
  cards?: GodChatCard[];
};
// seal 是 Worker 给「访客消息 + 这条回复 + trace」整对盖的章，只在助手消息上；历史里章对不上的一问一答整对丢掉。
export type GodChatMessage = { role: "user" | "assistant"; content: string; trace?: GodChatTrace; seal?: string };

export type GodChatSource = { url: string; title: string };

// 响应体是 NDJSON，每行一个事件；首行总是 route（refuse 时 tier 为 null），views 是 get_site_status 读取的视图键。
// doc 是 read_project_doc 的一次读取：doc 为文档键，path 为仓库内路径（别的仓库带 owner/repo 前缀），url 为 GitHub 页面，section 为实际读到的章节标题（没读章节或没匹配上时缺省）。
// issue 是 draft_github_issue 起草的草稿，卡片据此打开可编辑的提交表单，由访客登录 GitHub 后自己提交。
// card 是 show_card 要画的卡片，画在回复里收到这一行时正文已到的位置；同一条回复里同一张卡片只发一次。
// thinking 是模型思考的摘要（不是原文），只给界面在等正文时显示，不进对话历史；分几轮想时轮与轮之间补一个空行。
// served 只在给出最终答案的那一轮由 Anthropic 的拒答兜底模型答成（没被拒）时出现，回复末尾一次，model 是那个模型的 id。
export type GodChatEvent =
  | { type: "route"; route: GodChatRoute; tier: GodChatTier | null; downgradedFrom?: GodChatTier }
  | { type: "served"; model: string }
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "issue"; title: string; body: string }
  | { type: "card"; card: GodChatCard }
  | { type: "tool"; views: string[] }
  | { type: "doc"; doc: string; path: string; url: string; section?: string }
  | { type: "search"; query: string }
  | { type: "sources"; sources: GodChatSource[] }
  | { type: "seal"; seal: string; trace?: GodChatTrace };

export type GodChatRequest = { messages: GodChatMessage[]; turnstileToken: string };

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
  while (clipped.length > 1 && total > GOD_CHAT_LIMITS.maxTotalChars) total -= clipped.shift()!.content.length;
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
    ...(isGodChatTier(raw.tier) && { tier: raw.tier }),
    ...(effort && { effort }),
    ...(views.length && { views }),
    ...(docs.length && { docs }),
    ...(searches > 0 && { searches }),
    ...(raw.fallback === true && { fallback: true as const }),
    ...(raw.issue === true && { issue: true as const }),
    ...(cards.length && { cards }),
  };
  return Object.keys(trace).length ? trace : undefined;
}

export function parseGodChatRequest(body: unknown): GodChatRequest | null {
  if (!body || typeof body !== "object") return null;
  const { messages, turnstileToken } = body as Record<string, unknown>;
  if (typeof turnstileToken !== "string" || !turnstileToken || turnstileToken.length > 2048) return null;
  if (!Array.isArray(messages) || messages.length === 0) return null;

  const parsed: GodChatMessage[] = [];
  for (const message of messages.slice(-GOD_CHAT_LIMITS.maxMessages)) {
    if (!message || typeof message !== "object") return null;
    const { role, content, trace, seal } = message as Record<string, unknown>;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    const text = content.trim();
    if (!text) return null;
    if (role === "user" && text.length > GOD_CHAT_LIMITS.maxMessageChars) return null;
    const cleanTrace = role === "assistant" ? normalizeTrace(trace) : undefined;
    const cleanSeal = role === "assistant" && typeof seal === "string" && /^[\w-]{20,100}$/.test(seal) ? seal : undefined;
    parsed.push({ role, content: text, ...(cleanTrace && { trace: cleanTrace }), ...(cleanSeal && { seal: cleanSeal }) });
  }
  const fitted = fitHistory(parsed);
  if (!fitted.length || fitted[fitted.length - 1].role !== "user") return null;
  return { messages: fitted, turnstileToken };
}

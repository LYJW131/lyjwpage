import { isGodChatTier, type GodChatRoute, type GodChatTier } from "./god-chat-tiers";

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

// 浏览器只回传文字，工具调用的原始结果不回传；trace 记下那条回复由哪一档作答、查过哪些视图、搜了几次、
// 是否由拒答兜底的模型代答。Worker 据此告诉模型那条回复当时用过工具，否则它会以为自己当时是在编。
// trace 由浏览器提交、服务端核实不了，所以只当访客自报的说明，附在那条回复之前的访客消息里、标明未经核实，
// 也只收枚举与计数，不收任何自由文本（搜索词不回传）。
export type GodChatTrace = { tier?: GodChatTier; views?: string[]; searches?: number; fallback?: true };
export type GodChatMessage = { role: "user" | "assistant"; content: string; trace?: GodChatTrace };

export type GodChatSource = { url: string; title: string };

// 响应体是 NDJSON，每行一个事件；首行总是 route（refuse 时 tier 为 null），views 是 get_site_status 读取的视图键。
// served 只在给出最终答案的那一轮由 Anthropic 的拒答兜底模型答成（没被拒）时出现，回复末尾一次，model 是那个模型的 id。
export type GodChatEvent =
  | { type: "route"; route: GodChatRoute; tier: GodChatTier | null; downgradedFrom?: GodChatTier }
  | { type: "served"; model: string }
  | { type: "text"; text: string }
  | { type: "tool"; views: string[] }
  | { type: "search"; query: string }
  | { type: "sources"; sources: GodChatSource[] };

export type GodChatRequest = { messages: GodChatMessage[]; turnstileToken: string };

// 访客自己的话超长就拒；模型的旧回复只截断，超出总量从最早的消息丢起，长回答不能让后续对话发不出去。
// 浏览器发送前先过一遍，Worker 收到后再过一遍。
export function fitHistory(messages: GodChatMessage[]): GodChatMessage[] {
  const clipped = messages.slice(-GOD_CHAT_LIMITS.maxMessages).map((m) =>
    m.role === "assistant" && m.content.length > GOD_CHAT_LIMITS.maxReplyChars
      ? { ...m, content: `${m.content.slice(0, GOD_CHAT_LIMITS.maxReplyChars)}…` }
      : m,
  );
  let total = clipped.reduce((sum, m) => sum + m.content.length, 0);
  while (clipped.length > 1 && total > GOD_CHAT_LIMITS.maxTotalChars) total -= clipped.shift()!.content.length;
  while (clipped.length && clipped[0].role !== "user") clipped.shift();
  return clipped;
}

const shortStrings = (value: unknown, max: number, len: number): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= len).slice(0, max) : [];

function parseTrace(value: unknown): GodChatTrace | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const views = shortStrings(raw.views, 12, 40).filter((v) => /^[A-Za-z]+$/.test(v));
  const searches = Number.isInteger(raw.searches) ? Math.min(raw.searches as number, GOD_CHAT_LIMITS.maxWebSearches) : 0;
  const trace: GodChatTrace = {
    ...(isGodChatTier(raw.tier) && { tier: raw.tier }),
    ...(views.length && { views }),
    ...(searches > 0 && { searches }),
    ...(raw.fallback === true && { fallback: true as const }),
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
    const { role, content, trace } = message as Record<string, unknown>;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    const text = content.trim();
    if (!text) return null;
    if (role === "user" && text.length > GOD_CHAT_LIMITS.maxMessageChars) return null;
    const cleanTrace = role === "assistant" ? parseTrace(trace) : undefined;
    parsed.push(cleanTrace ? { role, content: text, trace: cleanTrace } : { role, content: text });
  }
  const fitted = fitHistory(parsed);
  if (!fitted.length || fitted[fitted.length - 1].role !== "user") return null;
  return { messages: fitted, turnstileToken };
}

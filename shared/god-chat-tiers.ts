// Clef 在三档里选：两档 DeepSeek Flash（关思考、开思考）与 Fable；额度用完时在这三档里往下降。
export const GOD_CHAT_RANKS = ["flash", "think", "fable"] as const;
export type GodChatRank = (typeof GOD_CHAT_RANKS)[number];
// Sonnet 只判断设计请求要不要开设计会话，不参与 Clef 的难度分档，也不降级。
export const GOD_CHAT_DESIGN_JUDGE = "sonnet" as const;
export const GOD_CHAT_TIERS = [...GOD_CHAT_RANKS, GOD_CHAT_DESIGN_JUDGE] as const;
export type GodChatTier = (typeof GOD_CHAT_TIERS)[number];
export const GOD_CHAT_DESIGN_TIER = "opus";
export type GodChatServedTier = GodChatTier | typeof GOD_CHAT_DESIGN_TIER;
export type GodChatRoute = GodChatServedTier | "refuse";

export type GodChatEffort = "low" | "medium" | "high";
export type GodChatProvider = "anthropic" | "deepseek";

// 有意的取舍：回复上限随档位放大。Fable、Sonnet 用 low 控成本和等待；DeepSeek 的 effort 只有 low / high 两档（medium 映射到 high）。
// Opus 不在路由与额度里，只在已开启的设计会话里作答，强度 medium。thinking 为 false 的档整条回复关掉思考，effort 不生效。
// serverFallback：该型号支持服务端拒答兜底（beta 头与 fallbacks 参数），只有 Anthropic 的型号有。
export type GodChatTierInfo = { model: string; label: string; persona: string; provider: GodChatProvider; thinking: boolean; effort: GodChatEffort; maxTokens: number; serverFallback: boolean };

export const GOD_CHAT_TIER_INFO: Record<GodChatServedTier, GodChatTierInfo> = {
  flash: { model: "deepseek-flash", label: "DeepSeek Flash", persona: "Small Fry", provider: "deepseek", thinking: false, effort: "low", maxTokens: 4096, serverFallback: false },
  think: { model: "deepseek-flash", label: "DeepSeek Flash Thinking", persona: "Prophet", provider: "deepseek", thinking: true, effort: "low", maxTokens: 8192, serverFallback: false },
  sonnet: { model: "claude-sonnet-5-5", label: "Sonnet 5.5", persona: "Herald", provider: "anthropic", thinking: true, effort: "low", maxTokens: 4096, serverFallback: true },
  fable: { model: "claude-fable-5-1", label: "Fable 5.1", persona: "God", provider: "anthropic", thinking: true, effort: "low", maxTokens: 8192, serverFallback: true },
  opus: { model: "claude-opus-5-5", label: "Opus 5.5", persona: "Architect", provider: "anthropic", thinking: true, effort: "medium", maxTokens: 4096, serverFallback: true },
};

export function isGodChatRank(value: unknown): value is GodChatRank {
  return GOD_CHAT_RANKS.includes(value as GodChatRank);
}

export function isGodChatTier(value: unknown): value is GodChatTier {
  return GOD_CHAT_TIERS.includes(value as GodChatTier);
}

export function isGodChatServedTier(value: unknown): value is GodChatServedTier {
  return isGodChatTier(value) || value === GOD_CHAT_DESIGN_TIER;
}

// 拒答兜底换上的模型不在上面几档里，展示名从 id 推：claude-opus-4-8 → Opus 4.8，日期后缀不显示。
export function modelLabel(model: string): string {
  const own = Object.values(GOD_CHAT_TIER_INFO).find((info) => info.model === model && info.provider === "anthropic");
  if (own) return own.label;
  const [family, ...version] = model.replace(/^claude-/, "").replace(/-\d{8}$/, "").split("-");
  if (!family) return model;
  return [family[0].toUpperCase() + family.slice(1), version.join(".")].filter(Boolean).join(" ");
}

// 选中的档位额度用完时从它往下逐档尝试，绝不往上升；设计判断档不降级。
export function downgradeChain(tier: GodChatTier): GodChatTier[] {
  if (!isGodChatRank(tier)) return [tier];
  return GOD_CHAT_RANKS.slice(0, GOD_CHAT_RANKS.indexOf(tier) + 1).reverse();
}

// 额度是公开端点花钱的闸：调 Clef 之前先过访客总量、全站路由次数与「至少一档还有空位」三道，管路由被刷；
// 每档再分访客与全站两道，在 Clef 选完档之后扣。计数在 ai Worker 的 ChatQuota Durable Object 里，/usage 读的是同一份（路由次数不单列）。
export const GOD_CHAT_QUOTA = {
  windowMs: 60_000,
  visitor: 10,
  tiers: {
    flash: { visitor: 8, everyone: 80 },
    think: { visitor: 5, everyone: 40 },
    sonnet: { visitor: 3, everyone: 24 },
    fable: { visitor: 1, everyone: 6 },
  },
} as const satisfies { windowMs: number; visitor: number; tiers: Record<GodChatTier, { visitor: number; everyone: number }> };

// 全站每窗口最多路由这么多条：路由完的消息总要占某一档的全站名额，超过各档全站名额之和的那些排不上任何一档，
// 不必再付费调 Clef。拒答不占档位名额，却也算进这里，站上被刷时可能挡掉本来排得上的消息，接受。
export const GOD_CHAT_ROUTE_LIMIT = GOD_CHAT_TIERS.reduce((sum, tier) => sum + GOD_CHAT_QUOTA.tiers[tier].everyone, 0);

export type GodChatCount = { used: number; limit: number };
export type GodChatUsage = {
  windowMs: number;
  resetInMs: number;
  visitor: GodChatCount;
  tiers: Record<GodChatTier, { visitor: GodChatCount; everyone: GodChatCount }>;
};


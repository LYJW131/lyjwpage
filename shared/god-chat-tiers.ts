export const GOD_CHAT_TIERS = ["haiku", "opus", "fable"] as const;
export type GodChatTier = (typeof GOD_CHAT_TIERS)[number];
export type GodChatRoute = GodChatTier | "refuse";

export type GodChatEffort = "low" | "medium" | "high";

// 有意的取舍：回复上限随档位放大，思考强度不跟档位走，Fable、Opus 用 low 控成本和等待。effort 是默认值：
// Clef 选 Haiku 时连强度一起选（workers/ai/src/chat/router.ts#CLEF_CHOICES），设计会话的 Opus 用 router.ts#DESIGN_EFFORT，
// 降级、强制档位或 Clef 不可用时才用这里的。
export type GodChatTierInfo = { model: string; label: string; persona: string; effort: GodChatEffort; maxTokens: number };

export const GOD_CHAT_TIER_INFO: Record<GodChatTier, GodChatTierInfo> = {
  haiku: { model: "claude-haiku-5-5", label: "Haiku 5.5", persona: "Small Fry", effort: "medium", maxTokens: 2048 },
  opus: { model: "claude-opus-5-5", label: "Opus 5.5", persona: "Prophet", effort: "low", maxTokens: 4096 },
  fable: { model: "claude-fable-5-1", label: "Fable 5.1", persona: "God", effort: "low", maxTokens: 8192 },
};

export function isGodChatTier(value: unknown): value is GodChatTier {
  return GOD_CHAT_TIERS.includes(value as GodChatTier);
}

// 拒答兜底换上的模型不在三档里，展示名从 id 推：claude-opus-4-8 → Opus 4.8，日期后缀不显示。
export function modelLabel(model: string): string {
  const own = Object.values(GOD_CHAT_TIER_INFO).find((info) => info.model === model);
  if (own) return own.label;
  const [family, ...version] = model.replace(/^claude-/, "").replace(/-\d{8}$/, "").split("-");
  if (!family) return model;
  return [family[0].toUpperCase() + family.slice(1), version.join(".")].filter(Boolean).join(" ");
}

// 选中的档位额度用完时从它往下逐档尝试，绝不往上升。
export function downgradeChain(tier: GodChatTier): GodChatTier[] {
  return GOD_CHAT_TIERS.slice(0, GOD_CHAT_TIERS.indexOf(tier) + 1).reverse();
}

// 额度是公开端点花钱的闸：调 Clef 之前先过访客总量、全站路由次数与「至少一档还有空位」三道，管路由被刷；
// 每档再分访客与全站两道，在 Clef 选完档之后扣。计数在 ai Worker 的 ChatQuota Durable Object 里，/usage 读的是同一份（路由次数不单列）。
export const GOD_CHAT_QUOTA = {
  windowMs: 60_000,
  visitor: 10,
  tiers: {
    haiku: { visitor: 6, everyone: 60 },
    opus: { visitor: 2, everyone: 15 },
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


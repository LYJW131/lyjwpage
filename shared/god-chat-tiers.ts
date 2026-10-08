export const GOD_CHAT_TIERS = ["haiku", "opus", "fable"] as const;
export type GodChatTier = (typeof GOD_CHAT_TIERS)[number];
export type GodChatRoute = GodChatTier | "refuse";

// 有意的取舍：回复上限随档位放大，思考强度不跟档位走，Fable、Opus 用 low 控成本和等待，Haiku 用 medium 补足。
export type GodChatTierInfo = { model: string; label: string; persona: string; effort: "low" | "medium" | "high"; maxTokens: number };

export const GOD_CHAT_TIER_INFO: Record<GodChatTier, GodChatTierInfo> = {
  haiku: { model: "claude-haiku-5-5", label: "Haiku 5.5", persona: "Small Fry", effort: "medium", maxTokens: 2048 },
  opus: { model: "claude-opus-5-5", label: "Opus 5.5", persona: "Prophet", effort: "low", maxTokens: 4096 },
  fable: { model: "claude-fable-5-1", label: "Fable 5.1", persona: "God", effort: "low", maxTokens: 8192 },
};

export function isGodChatTier(value: unknown): value is GodChatTier {
  return GOD_CHAT_TIERS.includes(value as GodChatTier);
}

// 选中的档位额度用完时从它往下逐档尝试，绝不往上升。
export function downgradeChain(tier: GodChatTier): GodChatTier[] {
  return GOD_CHAT_TIERS.slice(0, GOD_CHAT_TIERS.indexOf(tier) + 1).reverse();
}

// 额度是公开端点花钱的闸：窗口内访客总量管 Clef 与 Turnstile 被刷，每档再分访客与全站两道。
// 计数在 api Worker 的 ChatQuota Durable Object 里，/usage 读的是同一份。
export const GOD_CHAT_QUOTA = {
  windowMs: 60_000,
  visitor: 10,
  tiers: {
    haiku: { visitor: 6, everyone: 60 },
    opus: { visitor: 2, everyone: 15 },
    fable: { visitor: 1, everyone: 6 },
  },
} as const satisfies { windowMs: number; visitor: number; tiers: Record<GodChatTier, { visitor: number; everyone: number }> };

export type GodChatCount = { used: number; limit: number };
export type GodChatUsage = {
  windowMs: number;
  resetInMs: number;
  visitor: GodChatCount;
  tiers: Record<GodChatTier, { visitor: GodChatCount; everyone: GodChatCount }>;
};


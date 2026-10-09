import type Anthropic from "@anthropic-ai/sdk";

type IterationUsage = Anthropic.Beta.BetaIterationsUsage[number];

// 服务端拒答兜底时顶层 usage 只算给出答案的那一跳，被拒的那跳也计费，实际计费量要按 usage.iterations 逐条加。
// 与顶层取大：流式快照只在 message_delta 带 iterations 时才覆盖，万一留着不完整的一份，也不比顶层扣得少。
export function billedOutputTokens(usage: Pick<Anthropic.Beta.BetaUsage, "output_tokens" | "iterations">): number {
  if (!usage.iterations?.length) return usage.output_tokens;
  return Math.max(usage.output_tokens, usage.iterations.reduce((sum, iteration) => sum + iteration.output_tokens, 0));
}

export function usageHops(iterations: Anthropic.Beta.BetaIterationsUsage | null) {
  return (iterations ?? []).map((iteration: IterationUsage) => ({
    type: iteration.type,
    ...("model" in iteration && iteration.model && { model: iteration.model }),
    outputTokens: iteration.output_tokens,
  }));
}

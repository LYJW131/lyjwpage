import { readBoundedBytes, readBoundedJson } from "../build/http";

export const DESIGN_REQUEST_LIMITS = {
  maxRequests: 64,
  maxOutputTokens: 4096,
  requestBytes: 4 * 1024 * 1024,
  eventChars: 128 * 1024,
  requestTimeoutMs: 120_000,
} as const;

export type DesignPrices = { input: number; output: number; cacheRead: number; cacheWrite: number };
export type DesignBudget = {
  chargedMicroUsd: number;
  requests: number;
  reservations: Record<string, number>;
  // 预留被拒过一次即终态：chargedMicroUsd 可能仍低于上限，但下一次预留已经放不下，结果页按超支收尾。
  denied?: boolean;
};
export type DesignBudgetStore = {
  change<T>(update: (budget: DesignBudget) => T): Promise<T>;
  active(): Promise<boolean>;
};
export const emptyDesignBudget = (): DesignBudget => ({ chargedMicroUsd: 0, requests: 0, reservations: {} });

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function tokenCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

export function reserveDesignRequest(
  budget: DesignBudget,
  id: string,
  inputTokens: number,
  outputTokens: number,
  prices: DesignPrices,
  limitCents: number,
): boolean {
  if (!tokenCount(inputTokens) || !tokenCount(outputTokens) || outputTokens === 0
    || !Number.isFinite(limitCents) || limitCents <= 0
    || Object.values(prices).some((price) => !Number.isFinite(price) || price < 0)
    || budget.requests >= DESIGN_REQUEST_LIMITS.maxRequests || budget.denied === true) return false;
  const inputRate = Math.max(prices.input, prices.cacheRead, prices.cacheWrite, prices.input * 2);
  const reservation = Math.ceil(inputTokens * inputRate + outputTokens * prices.output);
  if (budget.chargedMicroUsd + reservation > limitCents * 10_000 || id in budget.reservations) return false;
  // Count-token estimates reserve the most expensive cache tier; unknown outcomes keep their reservation after restart.
  budget.chargedMicroUsd += reservation;
  budget.requests += 1;
  budget.reservations[id] = reservation;
  return true;
}

export function settleDesignRequest(budget: DesignBudget, id: string, microUsd: number): void {
  const reservation = budget.reservations[id];
  if (reservation === undefined || !Number.isFinite(microUsd) || microUsd < 0) return;
  budget.chargedMicroUsd = budget.chargedMicroUsd - reservation + Math.ceil(microUsd);
  delete budget.reservations[id];
}

export function designUsageMicroUsd(value: unknown, prices: DesignPrices): number | null {
  const usage = object(value);
  if (!usage || !tokenCount(usage.input_tokens) || !tokenCount(usage.output_tokens)) return null;
  const read = usage.cache_read_input_tokens ?? 0;
  const write = usage.cache_creation_input_tokens ?? 0;
  if (!tokenCount(read) || !tokenCount(write)) return null;
  const cache = object(usage.cache_creation);
  const hour = cache?.ephemeral_1h_input_tokens ?? 0;
  if (!tokenCount(hour) || hour > write) return null;
  return Math.ceil(usage.input_tokens * prices.input + usage.output_tokens * prices.output
    + read * prices.cacheRead + (write - hour) * prices.cacheWrite + hour * prices.input * 2);
}

export function designBudgetFetch({
  fetcher,
  store,
  model,
  prices,
  limitCents,
}: {
  fetcher: typeof fetch;
  store: DesignBudgetStore;
  model: string;
  prices: DesignPrices;
  limitCents: number;
}): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== "https://api.anthropic.com" || url.pathname !== "/v1/messages" || request.method !== "POST") {
      throw new Error("Unsupported planner model request.");
    }
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(DESIGN_REQUEST_LIMITS.requestTimeoutMs)]);
    const bytes = await readBoundedBytes(request.body, DESIGN_REQUEST_LIMITS.requestBytes);
    const payload = bytes ? object(JSON.parse(new TextDecoder().decode(bytes))) : null;
    if (!payload || payload.model !== model || payload.stream !== true || !tokenCount(payload.max_tokens) || payload.max_tokens < 1) {
      throw new Error("Invalid planner model request.");
    }
    if (!await store.active()) throw new Error("This design session has ended.");
    const outputTokens = Math.min(payload.max_tokens, DESIGN_REQUEST_LIMITS.maxOutputTokens);
    payload.max_tokens = outputTokens;
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    const countPayload = Object.fromEntries(
      ["model", "messages", "system", "tools", "tool_choice", "thinking"].filter((key) => key in payload).map((key) => [key, payload[key]]),
    );
    const counted = await fetcher("https://api.anthropic.com/v1/messages/count_tokens", {
      method: "POST", headers, body: JSON.stringify(countPayload), signal,
    });
    if (!counted.ok) {
      await counted.body?.cancel();
      throw new Error("The planner could not verify its request budget.");
    }
    const count = object(await readBoundedJson(counted, 8192))?.input_tokens;
    if (!tokenCount(count) || !await store.active()) throw new Error("The planner could not admit this request.");
    const id = crypto.randomUUID();
    const admitted = await store.change((budget) => reserveDesignRequest(budget, id, count, outputTokens, prices, limitCents));
    if (!admitted) {
      await store.change((budget) => { budget.denied = true; });
      throw new Error("This design session has used its budget.");
    }
    const response = await fetcher(url, { method: "POST", headers, body: JSON.stringify(payload), signal });
    if (!response.ok || !response.body) {
      if ([400, 401, 403, 404, 429].includes(response.status)) {
        await store.change((budget) => settleDesignRequest(budget, id, 0));
      }
      return response;
    }
    let buffer = "";
    let usage: Record<string, unknown> | null = null;
    let completed = false;
    let valid = true;
    const decoder = new TextDecoder();
    const observe = async (text: string) => {
      buffer += text;
      if (buffer.length > DESIGN_REQUEST_LIMITS.eventChars) {
        valid = false;
        buffer = "";
        return;
      }
      for (;;) {
        const boundary = buffer.search(/\r?\n\r?\n/);
        if (boundary < 0) break;
        const frame = buffer.slice(0, boundary);
        const delimiter = buffer.slice(boundary).match(/^\r?\n\r?\n/)![0];
        buffer = buffer.slice(boundary + delimiter.length);
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        let event: Record<string, unknown> | null;
        try { event = object(JSON.parse(data)); } catch { valid = false; continue; }
        if (event?.type === "message_start") {
          const message = object(event.message);
          if (message?.model !== model) valid = false;
          usage = object(message?.usage);
        } else if (event?.type === "message_delta" && usage) {
          const update = object(event.usage);
          if (update) usage = { ...usage, ...update };
        } else if (event?.type === "message_stop" && valid && usage && !completed) {
          const cost = designUsageMicroUsd(usage, prices);
          if (cost !== null) {
            await store.change((budget) => settleDesignRequest(budget, id, cost));
            completed = true;
          }
        }
      }
    };
    return new Response(response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      async transform(chunk, controller) {
        await observe(decoder.decode(chunk, { stream: true }));
        controller.enqueue(chunk);
      },
      async flush() { await observe(decoder.decode()); },
    }), { signal }), response);
  };
}

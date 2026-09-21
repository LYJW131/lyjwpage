import { codingTokenUsageKey } from "@/lib/coding-pulse";
import { tellStorage } from "@/lib/storage";
import { displayChanged } from "@shared/display-change";
import { VIBECODING_TAG } from "@/lib/live-events";
import type {
  VibeCodingNowPayload
} from "@/lib/types";
import {
  mergeAgentLimits
} from "@/lib/vibecoding-limits";
import {
  normalizeAgentLimits,
  normalizeVibeCodingNow,
  normalizeVibeCodingUsage,
  type ParsedAgentLimits,
  type ParsedVibeCodingNow,
  type ParsedVibeCodingUsage,
} from "@/lib/vibecoding-parse";
import { fanout } from "@api/fanout";
import { limitsMirror, nowMirror, usageMirror } from "@shared/vibecoding";

/**
 * Mac 信封里的两个模块一律「先校验，后落库」，写留给 commit。
 *
 * telemetry 入口先准备全部 coding 模块，再调用 commit；年度模块写坏时，
 * 前面那份根本还没落库，不会留下半截 coding 状态。写不再挡着推送，
 * 见 lib/live-events 的 fanout。
 */
export function prepareVibeCodingUsage(report: unknown, receivedAt = Date.now()) {
  const payload = normalizeVibeCodingUsage(report);
  if (!payload) throw new Error("vibeCodingUsage 必须是 Mac Telemetry Hub 的用量摘要");
  return prepareVibeCodingUsagePayload(payload, receivedAt);
}

export function prepareVibeCodingUsagePayload(payload: ParsedVibeCodingUsage, receivedAt: number) {
  return { payload, commit: () => usageMirror.put({ payload, pushedAt: receivedAt }) };
}

export function prepareVibeCodingNow(report: unknown, receivedAt = Date.now()) {
  const payload = normalizeVibeCodingNow(report);
  if (!payload) throw new Error("vibeCodingNow 必须带 agents 数组");
  return prepareVibeCodingNowPayload(payload, receivedAt);
}

export function prepareVibeCodingNowPayload(payload: ParsedVibeCodingNow, receivedAt: number) {
  return {
    payload,
    /** 推给浏览器的此刻补丁。用量还没到过也推 —— 它不依赖那份 */
    now: { agents: payload.agents } satisfies VibeCodingNowPayload,
    commit: async () => {
      if (payload.tokenUsage) await tellStorage(async (storage) => {
        const previous = await storage.get(codingTokenUsageKey());
        if (!previous || JSON.parse(previous).collectedAt <= payload.tokenUsage!.collectedAt)
          await storage.set(codingTokenUsageKey(), JSON.stringify(payload.tokenUsage));
      });
      await nowMirror.put({ payload: { agents: payload.agents }, pushedAt: receivedAt });
    },
  };
}

/**
 * `/api/ingest/agents`：容器上报器这一轮的限额，按 id 并进镜像。
 *
 * 每封都落库：上报器每轮必发，这一封就是心跳，不刷新 pushedAt 的话读那侧永远
 * 判不出它是什么时候死的。不广播 —— 限额几分钟才动一次，卡片 30 秒一轮自己来问；
 * 只推普通 tag 让首屏那份快照跟着走。第一次用 urgent：从「没有限额」到「有」，
 * 不该再给旧的降级快照顶几分钟。
 */
export async function recordAgentLimits(input: unknown, receivedAt = Date.now()) {
  return recordPreparedAgentLimits(prepareAgentLimits(input, receivedAt).limits, receivedAt);
}

export type PreparedAgentLimits = {
  source: "agents";
  receivedAt: number;
  limits: ParsedAgentLimits;
};

export function prepareAgentLimits(input: unknown, receivedAt = Date.now()): PreparedAgentLimits {
  const parsed = normalizeAgentLimits(input);
  if (!parsed) throw new Error("agents 必须是带 id 的限额行数组，id 不能重复");
  return { source: "agents", receivedAt, limits: parsed };
}

export async function recordPreparedAgentLimits(parsed: ParsedAgentLimits, receivedAt: number) {
  const previous = await limitsMirror.get();
  const next = mergeAgentLimits(previous, parsed, receivedAt);
  const changed = displayChanged(previous, next);

  await fanout({
    writes: [limitsMirror.put(next)],
    tags: changed ? [VIBECODING_TAG] : [],
  });

  return { accepted: parsed.agents.length };
}

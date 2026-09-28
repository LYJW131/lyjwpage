import { recordCursorObservation } from "@api/stores/pulse-source-observations";
import { codingTokenUsageKey } from "@/lib/coding-pulse";
import { tellStorage } from "@/lib/storage";
import { displayChanged } from "@shared/display-change";
import { cursorNowMirror, cursorUsageMirror } from "@shared/cursor-usage";
import { VIBECODING_TAG, type LiveEvent } from "@/lib/live-events";
import type {
  VibeCodingNowPayload
} from "@/lib/types";
import type { ParsedVibeCodingNow, ParsedVibeCodingUsage } from "@/lib/vibecoding-parse";
import type { PreparedAgentLimits } from "@shared/ingest/agents";
import { fanout } from "@api/fanout";
import { nowMirror, usageMirror } from "@shared/vibecoding";

/**
 * Mac 信封里的两个模块一律「先校验，后落库」：校验在上报入口（shared/ingest/telemetry.ts），
 * 这里只把已经收敛过的那份包成写，留给 commit。三份 coding 模块在入口一起校验过，
 * 年度模块写坏时整封在入口就被拒，不会留下半截 coding 状态。写不再挡着推送，
 * 见 lib/live-events 的 fanout。
 */
export function prepareVibeCodingUsagePayload(payload: ParsedVibeCodingUsage, receivedAt: number) {
  return { payload, commit: () => usageMirror.put({ payload, pushedAt: receivedAt }) };
}

export function prepareVibeCodingNowPayload(parsed: ParsedVibeCodingNow, receivedAt: number) {
  /**
   * Cursor 的此刻归容器（`cursorNow`），Mac 那份即使带着 cursor 也丢掉：Hub 的会话扫描
   * 不看 Cursor，那一行永远是空时刻、不在用，推给浏览器会把容器报的活动盖掉。
   */
  const payload = { ...parsed, agents: parsed.agents.filter((agent) => agent.id !== "cursor") };
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
 * `/api/ingest/agents` 的状态核心那一半：Cursor 的用量与此刻。限额在可滞后层，
 * 由上报入口直接写 KV（workers/ingress 的 lag-ingest），不进这里；收敛见 shared/ingest/agents.ts。
 *
 * Cursor 用量每封都落库；此刻变了才推 `vibecoding-now`，只推送、不失效首屏。
 */
export async function recordPreparedAgentLimits(prepared: PreparedAgentLimits) {
  const { limits: parsed, receivedAt, cursorUsage, cursorNow } = prepared;
  const writes: Promise<unknown>[] = [];
  const tags = new Set<string>();
  const events: LiveEvent[] = [];
  // 限额在可滞后层，由上报入口直接写 KV（workers/ingress 的 lag-ingest）；这里只剩 Cursor 的用量与此刻
  const previousCursor = cursorUsage || cursorNow ? await cursorNowMirror.get() : null;
  if (cursorUsage) {
    const previousUsage = await cursorUsageMirror.get();
    if (displayChanged(previousUsage?.report, cursorUsage)) {
      tags.add(VIBECODING_TAG);
    }
    writes.push(cursorUsageMirror.put({ report: cursorUsage, pushedAt: receivedAt }));
  }
  if (cursorUsage || (cursorNow && (!previousCursor || Date.parse(cursorNow.lastActivityAt) > Date.parse(previousCursor.now.lastActivityAt)))) {
    // A successful history refresh is a heartbeat even when cursorNow was deduplicated.
    // Use collection time so replaying an old report cannot revive source coverage.
    const t = cursorUsage ? Date.parse(cursorUsage.collectedAt) : receivedAt;
    const latest = cursorNow ?? previousCursor?.now;
    if (Number.isFinite(t) && t <= receivedAt + 60_000) {
      writes.push(recordCursorObservation({ t: Math.min(t, receivedAt),
        available: cursorUsage ? cursorUsage.state === "ok" && !cursorUsage.warning : true,
        lastActivityAt: latest ? Date.parse(latest.lastActivityAt) : null }));
    }
  }
  if (cursorNow) {
    const previousNow = previousCursor;
    // 此刻只改 Cursor 那行的灯和模型，不增减行：只推送，不失效首屏
    if (displayChanged(previousNow?.now, cursorNow)) {
      /**
       * 电平一律给 false，灯由浏览器按 lastActivityAt 现算：服务端算的电平会冻在
       * 两次推送之间，Cursor 那行不再有新事件时就没人来把它改回去。
       */
      events.push({
        type: "vibecoding-now",
        payload: { agents: [{ id: "cursor", ...cursorNow, active: false }] },
      });
    }
    writes.push(cursorNowMirror.put({ now: cursorNow, pushedAt: receivedAt }));
  }

  await fanout({ writes, events, tags: [...tags] });

  return {
    accepted: parsed?.agents.length ?? 0,
    cursorUsage: Boolean(cursorUsage),
    cursorNow: Boolean(cursorNow),
  };
}

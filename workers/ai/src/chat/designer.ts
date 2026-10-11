import type { GodChatEvent } from "@shared/god-chat";

import type { Env } from "../runtime";
import { DESIGN_REQUEST_LIMITS } from "./design-budget";
import type { DesignApi, DesignFrame, DesignTurnInput, DesignTurnResult } from "./design-turns";

export type { DesignApi, DesignFrame, DesignTurnInput, DesignTurnResult } from "./design-turns";
export { designRequestId, openingBrief, VISITOR_REPLY_PREFIX } from "./design-turns";

export class DesignStreamError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, code?: string) {
    super(`Design session stream failed (${status}).`);
    this.status = status;
    this.code = code;
  }
}

// RPC 只过 JSON：stream 走 fetch 拿回 NDJSON 帧，其它方法在对象内查持久记录。
export function designApi(env: Env): DesignApi {
  const stub = (sessionId: string) => env.DESIGN_SESSIONS!.getByName(sessionId);
  return {
    async create(designId, expiresAt) {
      await stub(designId).initialize(designId, expiresAt);
      return designId;
    },
    matches: (sessionId, requestId, latest) => stub(sessionId).matches(requestId, latest),
    async stream(sessionId, input, signal) {
      const response = await stub(sessionId).fetch(new Request("https://design-session.internal/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal,
      }));
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { code?: unknown } | null;
        throw new DesignStreamError(response.status, typeof body?.code === "string" ? body.code : undefined);
      }
      return response;
    },
    async cancel(sessionId, requestId) {
      await stub(sessionId).cancel(requestId);
    },
  };
}

// NDJSON 帧：event 行直接转给访客，result 行收尾；行本身有界，整个回合的行数不受限。
export async function designTurn({
  api,
  sessionId,
  input,
  emit,
  signal,
}: {
  api: DesignApi;
  sessionId: string;
  input: DesignTurnInput;
  emit: (event: GodChatEvent) => void;
  signal: AbortSignal;
}): Promise<DesignTurnResult> {
  const response = await api.stream(sessionId, input, signal);
  let result: DesignTurnResult | undefined;
  const reader = response.body?.getReader();
  if (!reader) return { complete: false, asked: false, views: [] };
  const decoder = new TextDecoder();
  let buffer = "";
  let wroteText = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > DESIGN_REQUEST_LIMITS.eventChars * 4) return { complete: false, asked: false, views: [] };
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline === -1) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line || line.length > DESIGN_REQUEST_LIMITS.eventChars) continue;
        const frame = JSON.parse(line) as DesignFrame;
        if (frame?.type === "event" && frame.event) {
          if (frame.event.type === "text" && frame.event.text.trim()) wroteText = true;
          emit(frame.event);
        } else if (frame?.type === "result" && frame.result) result = frame.result;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  // 这一跑已经给访客推过正文时不再附收场句，避免计划收尾句重复出现在正文后。
  const outcome = result ?? { complete: false, asked: false, views: [] };
  if (wroteText) return { ...outcome, lead: undefined };
  return outcome;
}

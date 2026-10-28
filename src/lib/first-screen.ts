import type { StatusPayloads } from "@shared/status-payloads";
import type { StatusViewKey } from "@shared/status-views";
import type { StatusResponse } from "@shared/types";

export const FIRST_SCREEN_FETCH_TIMEOUT_MS = 20_000;

// 首页要等全部状态读完才出页；Lighthouse 约 10 s 拿不到 HTML 就放弃，PageSpeed 回 400。正常一读 100–200 ms。
export const FIRST_SCREEN_STATUS_TIMEOUT_MS = 5_000;

export function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Deadline ${ms}ms exceeded`)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

export const FIRST_SCREEN_UNAVAILABLE = "Status unavailable";

export type FirstScreen<K extends StatusViewKey> = StatusResponse<StatusPayloads[K]>;

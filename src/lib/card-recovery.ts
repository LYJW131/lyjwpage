/**
 * 卡片崩溃之后的恢复节奏与上报去重（components/card-boundary 用）。纯逻辑，好测。
 *
 * 错误边界一旦兜住，整棵子树就卸载了：这张卡的数据 hook 不再轮询，也不会自己回来。
 * 所以恢复要有人主动做（点 Retry），也要有一点自动的 —— 服务端一次性的坏响应、
 * 部署那几分钟的错位，过一会儿就好了，不该让访客自己发现并去刷新整页。
 */

/**
 * 崩溃之后自动重试的间隔序列，用完就不再自动试，交给人（Retry / Reload）。
 * 逐步放长是因为一直崩的多半是真有 bug，不该一直空转、一直报错。
 */
export const RECOVERY_DELAYS_MS = [20_000, 60_000, 180_000] as const;

/** 同一张卡这么久没有再崩过，就当上一轮结束了，重试次数和上报去重都从头算 */
export const RECOVERY_FORGET_MS = 10 * 60_000;

export type FaultRecord = {
  /** 这次崩溃要不要报 Sentry：同一张卡、同样的错，在一轮里只报一次 */
  report: boolean;
  /** 这次崩溃之后多久自动重试；null 是自动重试用完了 */
  retryInMs: number | null;
  /** 这一轮里已经自动重试了几次（这次崩溃之前） */
  attempt: number;
};

/** 用来判「同样的错」：取错误信息，不带调用栈；抛的不一定是 Error 实例 */
export function describeFault(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
  return message.slice(0, 200);
}

export function createFaultLedger() {
  const rows = new Map<string, { attempts: number; at: number; messages: Set<string> }>();
  return {
    /** 一次崩溃：记账，返回该不该上报、多久之后自动重试 */
    record(label: string, message: string, now: number): FaultRecord {
      let row = rows.get(label);
      if (!row || now - row.at > RECOVERY_FORGET_MS) {
        row = { attempts: 0, at: now, messages: new Set() };
        rows.set(label, row);
      }
      row.at = now;
      const attempt = row.attempts;
      const retryInMs = RECOVERY_DELAYS_MS[attempt] ?? null;
      // 排上了一次自动重试就算一次；重试若又崩，下一次崩溃拿到的是下一档间隔
      if (retryInMs !== null) row.attempts += 1;
      const report = !row.messages.has(message);
      row.messages.add(message);
      return { report, retryInMs, attempt };
    },
  };
}

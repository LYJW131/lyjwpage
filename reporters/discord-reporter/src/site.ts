import { info } from "./log.js";
import { config } from "./config.js";
import type { PresenceReport } from "./presence.js";

type SiteEnvelope<T> = { ok?: boolean; error?: string; data?: T };

function authHeaders(): Record<string, string> {
  return config.site.secret ? { Authorization: `Bearer ${config.site.secret}` } : {};
}

/**
 * 和另一份上报器的同名函数是同一段代码（只有下面那行注释不同，
 * 见 reporters/emby-reporter/src/site.ts），改一处记得同步另一处。
 *
 * 这不是随手的复制粘贴：它规定了「站点回了 `ok !== true` 就算失败」这条约定，
 * 是**协议**的一部分。两份哪天分了岔，症状会是其中一个上报器把站点的软失败当成
 * 了成功 —— 而没有任何测试或类型会拦住。两个上报器各自是独立的部署单元、
 * 各自 `docker compose up --build`，所以不抽成共享包（理由见 log.ts）。
 */
async function readEnvelope<T>(response: Response): Promise<T | undefined> {
  const body = (await response.json().catch(() => null)) as SiteEnvelope<T> | null;
  if (!response.ok || body?.ok !== true) {
    throw new Error(`站点返回 ${response.status}${body?.error ? `：${body.error}` : ""}`);
  }
  return body.data;
}

export async function push(presence: PresenceReport): Promise<{ changed: boolean }> {
  if (config.dryRun) {
    info(`[dry-run] ${JSON.stringify(presence)}`);
    return { changed: false };
  }
  const response = await fetch(config.site.ingestUrl, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ version: 1, presence }),
    signal: AbortSignal.timeout(config.pushTimeoutMs),
  });
  const data = await readEnvelope<{ changed?: boolean }>(response);
  return { changed: data?.changed === true };
}

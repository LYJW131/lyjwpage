import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./runtime";

/**
 * 临时：把外部 API 的只读令牌交接给采集 Worker，交接完随下一次部署删掉。
 *
 * Worker Secret 读不回来，这几把令牌只在 api 上有。只有同账号里声明了这个
 * binding 的 Worker 调得到；名单写死，别的 Secret 一律不给。
 */
const HANDED_OVER = new Set([
  "GITHUB_TOKEN",
  "VERCEL_TOKEN",
  "CLOUDFLARE_METRICS_TOKEN",
  "SENTRY_API_TOKEN",
  "PAGESPEED_API_KEY",
]);

export class SecretHandoff extends WorkerEntrypoint<Env> {
  async take(name: string): Promise<string | null> {
    if (!HANDED_OVER.has(name)) return null;
    const value = (this.env as unknown as Record<string, unknown>)[name];
    return typeof value === "string" && value ? value : null;
  }
}

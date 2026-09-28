import { WorkerEntrypoint } from "cloudflare:workers";
import { executePublicRequest } from "./public-execution";
import type { Env } from "./runtime";

/**
 * 只在本地绑定（wrangler.test.toml 的 `DEV_OVERRIDE_READER`）：LivePushRoom 转发生产推送前，
 * 问一下这条事件对应的端点有没有生效的假数据注入。Durable Object 里跑不了公开读取那一套，
 * 所以经同一个 Worker 的具名入口绕一下。调用方只传已经映射好的 `/api/status/` 路径。
 */
export class DevOverrideReader extends WorkerEntrypoint<Env> {
  async devOverride(path: string): Promise<Response> {
    if (!path.startsWith("/api/status/")) return new Response("Not found", { status: 404 });
    return executePublicRequest(
      new Request(`https://dev-override.internal/api/dev/override${path}`),
      this.env,
      this.ctx,
    );
  }
}

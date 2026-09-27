import { WorkerEntrypoint } from "cloudflare:workers";

import originWorker, { commitIngest } from "./origin-worker";
import type { Env } from "./runtime";

/**
 * playstation-reporter 经 Service Binding 直接调这里上报，不走公网、不带凭据：
 * 只有同账号里声明了这个 binding 的 Worker 调得到，所以这扇门本身就是鉴权。
 * 只能写 `playstation` 一个来源，并读取连接数与当前游玩状态。
 */
export class PlaystationIngest extends WorkerEntrypoint<Env> {
  /** 固定读端点，不允许调用方传入任意路径或来源。 */
  async count(): Promise<Response> {
    return originWorker.fetch(new Request("https://api.internal/count"), this.env, this.ctx);
  }

  async playingNow(): Promise<Response> {
    return originWorker.fetch(new Request("https://api.internal/api/status/playing/now"), this.env, this.ctx);
  }

  async ingest(raw: string): Promise<Response> {
    return commitIngest(this.env, this.ctx, "playstation", raw);
  }
}

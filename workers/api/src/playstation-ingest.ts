import { WorkerEntrypoint } from "cloudflare:workers";

import { commitIngest } from "./origin-worker";
import type { Env } from "./runtime";

/**
 * playstation-reporter 经 Service Binding 直接调这里上报，不走公网、不带凭据：
 * 只有同账号里声明了这个 binding 的 Worker 调得到，所以这扇门本身就是鉴权。
 * 只能写 `playstation` 一个来源 —— binding 拿到的是这个类，不是整个 ingest。
 */
export class PlaystationIngest extends WorkerEntrypoint<Env> {
  async ingest(raw: string): Promise<Response> {
    return commitIngest(this.env, this.ctx, "playstation", raw);
  }
}

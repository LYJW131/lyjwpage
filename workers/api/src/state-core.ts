import { WorkerEntrypoint } from "cloudflare:workers";
import { withRequestState } from "@shared/request-state";
import type { CorePower, CoreReply, StateCoreRpc } from "@shared/state-core";
import { getPlaystationPower } from "@/lib/playstation-store";
import type { ListeningItem } from "@/lib/types";

import { commitRecentlyPlayed } from "./apple-music-recent";
import { expireStatusTags, ROOM_ID } from "./live-platform";
import { issueApiDeveloperToken } from "./musickit-token";
import { commitIngest } from "./origin-worker";
import { requestStore, type Env } from "./runtime";

/**
 * 状态核心对内的 RPC 入口（契约见 shared/state-core.ts）。上报入口和采集 Worker
 * 经 Service Binding 调这里，不走公网、不带凭据：同账号里声明了这个 binding 的
 * Worker 才调得到，所以这扇门本身就是鉴权；鉴权只在系统边界做一次。
 */
export class StateCore extends WorkerEntrypoint<Env> implements StateCoreRpc {
  async ingest(source: string, raw: string): Promise<CoreReply> {
    const response = await commitIngest(this.env, this.ctx, source, raw);
    return { status: response.status, body: await response.json() };
  }

  async connections(): Promise<number> {
    const room = this.env.LIVE_PUSH.get(this.env.LIVE_PUSH.idFromName(ROOM_ID));
    return room.connectionCount();
  }

  async playstationPower(): Promise<CorePower> {
    return this.scoped(async () => {
      const power = await getPlaystationPower();
      return power ? { on: power.on, observedAt: power.observedAt } : null;
    });
  }

  async appleDeveloperToken(): Promise<{ token: string; expiresAt: number }> {
    const issued = await issueApiDeveloperToken(this.env);
    return { token: issued.token, expiresAt: issued.expiresAt * 1000 };
  }

  async commitRecentlyPlayed(items: ListeningItem[]): Promise<{ changed: boolean }> {
    return this.scoped(() => commitRecentlyPlayed(items));
  }

  async revalidate(tags: string[]): Promise<void> {
    await this.scoped(() => expireStatusTags([...new Set(tags)]));
  }

  /** 共用读写工具靠请求作用域拿 env 与存储，RPC 进来时补上这一层 */
  private scoped<T>(run: () => Promise<T>): Promise<T> {
    return withRequestState(() => requestStore.run({ env: this.env, ctx: this.ctx }, run));
  }
}

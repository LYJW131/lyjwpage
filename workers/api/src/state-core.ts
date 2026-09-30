import { WorkerEntrypoint } from "cloudflare:workers";
import { withRequestState } from "@shared/request-state";
import type { CoreCommand } from "@shared/ingest/prepare";
import type { CommitReply, CoreAudience, CorePower, StateCoreRpc } from "@shared/state-core";
import type { LiveEvent } from "@/lib/live-events";
import { getPlaystationPower } from "@/lib/playstation-store";
import type { ListeningItem, RecentTrack } from "@/lib/types";

import { commitRecentlyPlayed, commitRecentTracks } from "./apple-music-recent";
import { dispatchIngestEffects } from "./ingest-effects";
import { expireStatusTags, ROOM_ID } from "./live-platform";
import { issueApiDeveloperToken } from "./musickit-token";
import { requestStore, type Env } from "./runtime";

/**
 * 状态核心对内的 RPC 入口（契约见 shared/state-core.ts）。上报入口和采集 Worker
 * 经 Service Binding 调这里，不走公网、不带凭据：同账号里声明了这个 binding 的
 * Worker 才调得到，所以这扇门本身就是鉴权；鉴权只在系统边界（上报入口）做一次。
 */
export class StateCore extends WorkerEntrypoint<Env> implements StateCoreRpc {
  async ready(): Promise<boolean> {
    return this.hub().ready();
  }

  /**
   * 调用方 prepare 好的命令进 StateHub 串行提交。StateHub 只收集可序列化的效果，
   * 推送、Apple 目录补充和首屏失效在这里按 waitUntil 派发 —— 先派发再看结果：
   * 较晚模块失败时，排在前面、已经落库的写照样要通知。
   */
  async commitIngest(command: CoreCommand): Promise<CommitReply> {
    return this.scoped(async () => {
      const result = await this.hub().commitIngest(command);
      await dispatchIngestEffects(result.effects);
      if (!result.ready) return { ready: false, ok: false };
      if (!result.ok) return { ready: true, ok: false, error: result.error };
      return { ready: true, ok: true, data: JSON.parse(result.json) as unknown };
    });
  }

  /**
   * 站点新部署接管了生产域名（上报入口收到 GitHub Actions 的通知后调这里）：广播一条
   * 不带数据的 `version`，开着的页面重问 /api/version。推什么版本由域名上那次部署自己回答。
   */
  async broadcastVersion(): Promise<number> {
    return this.room().broadcast(JSON.stringify({ type: "version", payload: null } satisfies LiveEvent));
  }

  async audience(): Promise<CoreAudience> {
    return this.room().audience();
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

  async commitRecentTracks(tracks: RecentTrack[]): Promise<{ traced: boolean }> {
    return this.scoped(() => commitRecentTracks(tracks));
  }

  async revalidate(tags: string[]): Promise<void> {
    await this.scoped(() => expireStatusTags([...new Set(tags)]));
  }

  private hub() {
    return this.env.STATE.get(this.env.STATE.idFromName("global"));
  }

  private room() {
    return this.env.LIVE_PUSH.get(this.env.LIVE_PUSH.idFromName(ROOM_ID));
  }

  /** 共用读写工具靠请求作用域拿 env 与存储，RPC 进来时补上这一层 */
  private scoped<T>(run: () => Promise<T>): Promise<T> {
    return withRequestState(() => requestStore.run({ env: this.env, ctx: this.ctx }, run));
  }
}

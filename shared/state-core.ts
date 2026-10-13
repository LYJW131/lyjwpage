import type { ListeningItem, PlayingContainer, RecentTrack } from "@shared/types";
import type { CoreCommand } from "@shared/ingest/prepare";
import type { EnrichmentPatch } from "@shared/track-enrichment";

// 状态核心总是就绪：ready() 恒为 true，回执不出现 ready: false；两者留在契约里是因为只加不改。
export type CommitReply =
  | { ready: false; ok: false }
  | { ready: true; ok: true; data: unknown }
  | { ready: true; ok: false; error: string; retryable?: true };

export type CoreAudience = { connections: number; online: number };

export type CorePower = { on: boolean; observedAt: number } | null;

export interface StateCoreRpc {
  ready(): Promise<boolean>;
  commitIngest(command: CoreCommand): Promise<CommitReply>;
  broadcastVersion(): Promise<number>;
  audience(): Promise<CoreAudience>;
  playstationPower(): Promise<CorePower>;
  appleDeveloperToken(): Promise<{ token: string; expiresAt: number }>;
  // container：items[0] 的曲目顺序，null 表示它没有曲目（电台）；缺省时保留上一份。
  // items[0].motion：null 表示确定没有动态封面，undefined 表示调用方没查出结果。
  commitRecentlyPlayed(items: ListeningItem[], container?: PlayingContainer | null): Promise<{ changed: boolean }>;
  // observedAt：采集 Worker 拿到这份列表的 epoch 毫秒；缺省按收到的时刻。
  // nextBy：照推断接着放，下一首最晚这一刻（epoch 毫秒）排进列表最前；没有还在放的推断时缺省。
  commitRecentTracks(tracks: RecentTrack[], observedAt?: number): Promise<{ traced: boolean; nextBy?: number }>;
  revalidate(tags: string[]): Promise<void>;
  // 回执后重查到的补全按 trackKey 补写；曲目已换或没有一块变好时 applied 为 false。
  commitEnrichmentPatch(patch: EnrichmentPatch): Promise<{ applied: boolean }>;
}

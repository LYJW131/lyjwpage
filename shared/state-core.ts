import type { ListeningItem, RecentTrack } from "@/lib/types";
import type { CoreCommand } from "@shared/ingest/prepare";

export type CommitReply =
  | { ready: false; ok: false }
  | { ready: true; ok: true; data: unknown }
  | { ready: true; ok: false; error: string };

export type CoreAudience = { connections: number; online: number };

export type CorePower = { on: boolean; observedAt: number } | null;

export interface StateCoreRpc {
  ready(): Promise<boolean>;
  commitIngest(command: CoreCommand): Promise<CommitReply>;
  broadcastVersion(): Promise<number>;
  audience(): Promise<CoreAudience>;
  playstationPower(): Promise<CorePower>;
  appleDeveloperToken(): Promise<{ token: string; expiresAt: number }>;
  commitRecentlyPlayed(items: ListeningItem[]): Promise<{ changed: boolean }>;
  commitRecentTracks(tracks: RecentTrack[]): Promise<{ traced: boolean }>;
  revalidate(tags: string[]): Promise<void>;
}

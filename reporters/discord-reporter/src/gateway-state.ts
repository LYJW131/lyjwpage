import { reportFrom, type PresenceReport } from "./presence.ts";

export type GatewayPacket = { t?: string | null; d?: unknown };
export type SnapshotObservation = { guildId: string; revision: number };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function userId(value: unknown): unknown {
  return record(record(value)?.user)?.id;
}

function guildId(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export class GatewayState {
  private ready = false;
  private snapshot: PresenceReport | null = null;
  private snapshotGuildId: string | null = null;
  private lastObservedAt = 0;
  private revision = 0;
  private readonly targetUserId: string;
  private readonly onInvalidated: () => void;

  constructor(targetUserId: string, onInvalidated: () => void = () => {}) {
    this.targetUserId = targetUserId;
    this.onInvalidated = onInvalidated;
  }

  private invalidate(): void {
    this.revision += 1;
    this.snapshot = null;
    this.snapshotGuildId = null;
    this.onInvalidated();
  }

  disconnect(): void {
    this.ready = false;
    this.invalidate();
  }

  markReady(): PresenceReport | null {
    if (this.ready) return null;
    this.ready = true;
    return this.snapshot;
  }

  private observationTime(now: number): number {
    this.lastObservedAt = Math.max(now, this.lastObservedAt + 1);
    return this.lastObservedAt;
  }

  accept(packet: GatewayPacket, observedAt = Date.now()): PresenceReport | null {
    const data = record(packet.d);
    if (packet.t === "GUILD_DELETE" || (packet.t === "GUILD_CREATE" && data?.unavailable === true)) {
      if (this.snapshotGuildId && guildId(data?.id) === this.snapshotGuildId) this.invalidate();
      return null;
    }
    if (packet.t === "GUILD_MEMBER_REMOVE") {
      if (this.snapshotGuildId && guildId(data?.guild_id) === this.snapshotGuildId
        && userId(data) === this.targetUserId) this.invalidate();
      return null;
    }

    let presence: Record<string, unknown> | null = null;
    let sourceGuildId: string | null = null;
    if (packet.t === "PRESENCE_UPDATE") {
      if (userId(data) !== this.targetUserId) return null;
      sourceGuildId = guildId(data?.guild_id);
      presence = data;
    } else if (packet.t === "GUILD_CREATE") {
      if (!data || !Array.isArray(data.presences)) return null;
      sourceGuildId = guildId(data.id);
      const mine = data.presences.find((value: unknown) => userId(value) === this.targetUserId);
      if (mine) {
        presence = record(mine);
      } else if (!this.snapshot && Array.isArray(data.members)
        && data.members.some((value: unknown) => userId(value) === this.targetUserId)) {
        // An omitted presence alone does not prove that this guild contains the target.
        presence = { status: "offline", activities: [] };
      } else {
        return null;
      }
    } else {
      return null;
    }
    if (!sourceGuildId) return null;
    const next = reportFrom(presence, observedAt);
    if (!next) {
      this.invalidate();
      return null;
    }
    this.revision += 1;
    this.snapshot = { ...next, observedAt: this.observationTime(observedAt) };
    this.snapshotGuildId = sourceGuildId;
    return this.ready ? this.snapshot : null;
  }

  observation(): SnapshotObservation | null {
    return this.ready && this.snapshot && this.snapshotGuildId
      ? { guildId: this.snapshotGuildId, revision: this.revision }
      : null;
  }

  private isCurrent(observation: SnapshotObservation): boolean {
    return this.ready && this.snapshot !== null && this.snapshotGuildId === observation.guildId
      && this.revision === observation.revision;
  }

  invalidateIfCurrent(observation: SnapshotObservation): void {
    if (this.isCurrent(observation)) this.invalidate();
  }

  heartbeatIfCurrent(observation: SnapshotObservation, observedAt = Date.now()): PresenceReport | null {
    return this.isCurrent(observation) ? this.heartbeat(observedAt) : null;
  }

  heartbeat(observedAt = Date.now()): PresenceReport | null {
    return this.ready && this.snapshot
      ? { ...this.snapshot, observedAt: this.observationTime(observedAt) }
      : null;
  }
}

import type { PresenceReport } from "./presence.js";

export type PushResult = { changed: boolean };
type Push = (presence: PresenceReport, signal: AbortSignal) => Promise<PushResult>;
type Pending = { presence: PresenceReport; reason: string };

export class ReportQueue {
  private pending: Pending | null = null;
  private running: Promise<void> | null = null;
  private active: AbortController | null = null;

  private readonly push: Push;
  private readonly success: (result: PushResult, report: Pending) => void;
  private readonly failure: (error: unknown) => void;

  constructor(
    push: Push,
    success: (result: PushResult, report: Pending) => void,
    failure: (error: unknown) => void,
  ) {
    this.push = push;
    this.success = success;
    this.failure = failure;
  }

  clear(): void {
    this.pending = null;
    this.active?.abort();
  }

  enqueue(presence: PresenceReport, reason: string): Promise<void> {
    this.pending = { presence, reason };
    this.running ??= this.drain().finally(() => {
      this.running = null;
      if (this.pending) void this.enqueue(this.pending.presence, this.pending.reason);
    });
    return this.running;
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      const next = this.pending;
      this.pending = null;
      const controller = new AbortController();
      this.active = controller;
      try {
        const result = await this.push(next.presence, controller.signal);
        if (!controller.signal.aborted) this.success(result, next);
      } catch (error) {
        if (!controller.signal.aborted) this.failure(error);
      } finally {
        if (this.active === controller) this.active = null;
      }
    }
  }
}

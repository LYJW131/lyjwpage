"use client";

import { useEffect, useMemo, useState } from "react";

import { useMountedAt } from "@/hooks/use-mounted-at";
import { usePageActive } from "@/hooks/use-status";
import {
  HEARTBEAT_WINDOW_MS,
  RESUME_REFETCH_GRACE_MS,
  chargingFeedClockStale,
  clockAdvance,
  clockReading,
  confirmStale,
  hasPendingDeadline,
  isStale,
  liveChargingFeed,
  liveNowListening,
  resumeStep,
  resumeTimedOut,
  type ChargingFeed,
  type ResumeState,
} from "@/lib/freshness";
import type { NowListeningPayload, ReporterPresence } from "@/lib/types";

// isStale 使用严格大于；闹钟必须越过边界，否则不会判旧也不会再推进。
function deadlineOf(at: number | null | undefined, windowMs: number): number | null {
  return at != null && at > 0 ? at + windowMs + 1 : null;
}

type Clock = {
  now: number;
  settled: boolean;
};

function useClock(servedAt: number | undefined, deadlines: readonly (number | null)[]): Clock {
  const mountedAt = useMountedAt();
  const [ticked, setTicked] = useState(0);
  const now = clockReading(ticked, mountedAt, servedAt);
  const signature = deadlines.map((at) => (at == null ? "" : String(at))).join(",");
  const stable = useMemo(
    () => signature.split(",").map((part) => (part === "" ? null : Number(part))),
    [signature],
  );
  const key = `${now}|${signature}`;
  const [checked, setChecked] = useState<string | null>(null);
  const settled = !hasPendingDeadline(now, stable) || checked === key;

  useEffect(() => {
    const advance = clockAdvance(now, stable, Date.now());
    if (advance.kind === "idle") return;
    const tick = () => setTicked(Math.max(Date.now(), advance.to));
    if (advance.kind === "now") {
      const timer = window.setTimeout(tick, 0);
      return () => window.clearTimeout(timer);
    }
    const settle = window.setTimeout(() => setChecked(key), 0);
    const timer = window.setTimeout(tick, advance.delayMs);
    return () => {
      window.clearTimeout(settle);
      window.clearTimeout(timer);
    };
  }, [stable, now, key]);

  return { now, settled };
}

function useClockStale(at: number | null | undefined, windowMs: number, servedAt?: number) {
  const { now, settled } = useClock(servedAt, [deadlineOf(at, windowMs)]);
  return { stale: isStale({ now, at, windowMs }), settled };
}

export function useStale(at: number | null | undefined, windowMs: number, servedAt?: number) {
  return useClockStale(at, windowMs, servedAt).stale;
}

export function useStaleFlags(times: readonly (number | null | undefined)[], windowMs: number, servedAt?: number): boolean[] {
  const signature = times.map((at) => (typeof at === "number" ? String(at) : "")).join(",");
  const stable = useMemo(
    () => signature.split(",").map((part) => (part === "" ? undefined : Number(part))),
    [signature],
  );
  const { now } = useClock(servedAt, stable.map((at) => deadlineOf(at, windowMs)));
  return stable.map((at) => isStale({ now, at, windowMs }));
}

export function useConfirmedStale(stale: boolean, validating: boolean, settled = true): boolean {
  const active = usePageActive();
  const [resume, setResume] = useState<ResumeState>({ active, resuming: false, sawValidating: false });
  const nextResume = resumeStep(resume, { active, validating });
  if (nextResume !== resume) setResume(nextResume);
  const waitingForRefetch = nextResume.resuming && !nextResume.sawValidating;
  useEffect(() => {
    if (!waitingForRefetch) return;
    const timer = window.setTimeout(() => setResume(resumeTimedOut), RESUME_REFETCH_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [waitingForRefetch]);

  const [held, setHeld] = useState(stale);
  const next = confirmStale(held, {
    stale,
    active,
    validating: validating || nextResume.resuming,
    settled,
  });
  if (next.held !== held) setHeld(next.held);
  return next.stale;
}

export type StatusTiming = {
  validating: boolean;
  servedAt?: number;
};

export function useConfirmedClockStale(
  at: number | null | undefined,
  windowMs: number,
  { validating, servedAt }: StatusTiming,
): boolean {
  const { stale, settled } = useClockStale(at, windowMs, servedAt);
  return useConfirmedStale(stale, validating, settled);
}

export function useReporterStale(presence: ReporterPresence | undefined, servedAt?: number) {
  const { stale: byClock, settled } = useClockStale(
    presence?.lastSeenAt,
    presence?.heartbeatWindowMs ?? HEARTBEAT_WINDOW_MS,
    servedAt,
  );
  const declared = Boolean(presence?.declaredOffline);
  return { offline: declared || byClock, declared, byClock, settled };
}

export function useLiveChargingFeed<T extends ChargingFeed>(
  feed: T | undefined,
  { validating, servedAt }: StatusTiming,
): T | undefined {
  const { now, settled } = useClock(servedAt, [
    feed ? deadlineOf(feed.lastSeenAt, feed.heartbeatWindowMs) : null,
    feed ? deadlineOf(feed.pushedAt, feed.staleAfterMs) : null,
  ]);
  const clockStale = useConfirmedStale(
    feed ? chargingFeedClockStale(feed, now) : false,
    validating,
    settled,
  );
  return useMemo(() => (feed ? liveChargingFeed(feed, clockStale) : undefined), [feed, clockStale]);
}

export function useLiveNowListening(
  payload: NowListeningPayload | undefined,
  { validating, servedAt }: StatusTiming,
): NowListeningPayload | undefined {
  const { declared, byClock, settled } = useReporterStale(payload, servedAt);
  const clockOffline = useConfirmedStale(byClock, validating, settled);
  const macOffline = declared || clockOffline;
  return useMemo(() => (payload ? liveNowListening(payload, macOffline) : undefined), [payload, macOffline]);
}

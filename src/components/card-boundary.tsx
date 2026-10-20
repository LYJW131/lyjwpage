"use client";

import { Activity, Component, useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshCw, RotateCw } from "lucide-react";
import { useSWRConfig } from "swr";

import { Card } from "@/components/ui/card";
import { useVersionStatus } from "@/hooks/use-app-version";
import { createFaultLedger, describeFault, primeCardCache, type FaultRecord } from "@/lib/card-recovery";
import { reportError } from "@/lib/error-report";
import { fetchStatus, guardPolled, writeGeneration } from "@/lib/status-reads";
import { viewKeyByPath } from "@shared/status-views";
import { cn } from "@/lib/utils";

// 崩溃数据可能来自 SWR fallbackData，单纯清缓存会再次读回它；重挂前先预取。
// 预取期间的推送/轮询可能更新同键，恢复只能写入仍属同一代的数据。
type CardBoundaryProps = {
  label: string;
  className?: string;
  silent?: boolean;
  paths?: readonly string[];
};

const faults = createFaultLedger();

function CardFault({
  label,
  className,
  silent,
  paths,
  error,
  reset,
}: CardBoundaryProps & { error: unknown; reset: () => void }) {
  const { status } = useVersionStatus();
  const { mutate, cache } = useSWRConfig();
  const stale = status === "stale";
  const [retrying, setRetrying] = useState(false);
  const recovering = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const recover = async () => {
    if (recovering.current) return;
    recovering.current = true;
    setRetrying(true);
    try {
      await primeCardCache(paths ?? [], {
        isStatusPath: (path) => viewKeyByPath(path) !== undefined,
        read: (path) => fetchStatus(path),
        write: (path, value) =>
          mutate(path, value === undefined ? undefined : guardPolled(path, value), { revalidate: value === undefined }),
        generation: writeGeneration,
        cacheData: (path) => cache.get(path)?.data,
        cancelled: () => !mounted.current,
      });
    } finally {
      recovering.current = false;
      if (mounted.current) {
        setRetrying(false);
        reset();
      }
    }
  };
  const recoverRef = useRef(recover);
  useEffect(() => {
    recoverRef.current = recover;
  });

  const episode = useRef<(FaultRecord & { reported: boolean }) | null>(null);
  useEffect(() => {
    episode.current ??= { ...faults.record(label, describeFault(error), Date.now()), reported: false };
    const current = episode.current;
    if (!current.report || current.reported) return;
    current.reported = true;
    reportError(error, "boundary", { card: label, versionStatus: status, retries: String(current.attempt) });
  }, [error, label, status]);

  useEffect(() => {
    const delay = episode.current?.retryInMs ?? null;
    if (delay === null || (stale && !silent)) return;
    let due = false;
    const attempt = () => {
      if (!due || document.visibilityState === "hidden") return;
      due = false;
      void recoverRef.current();
    };
    const timer = window.setTimeout(() => {
      due = true;
      attempt();
    }, delay);
    document.addEventListener("visibilitychange", attempt);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", attempt);
    };
  }, [stale, silent]);

  if (silent) return null;
  const button =
    "paper-card inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-line-strong bg-surface px-4 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover";
  return (
    <Card label={label} tone="off" action="Unavailable" className={cn("h-full", className)}>
      <div className="flex min-h-28 flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="text-sm text-muted-foreground">
          {stale
            ? "This card is out of date with the site. Reload to update."
            : "This card hit an error and was paused."}
        </p>
        <div className="flex items-center gap-2">
          {!stale && (
            <button
              type="button"
              onClick={() => void recover()}
              disabled={retrying}
              aria-busy={retrying}
              className={cn(button, "disabled:cursor-progress disabled:opacity-60")}
            >
              <RotateCw className={cn("size-3", retrying && "motion-safe:animate-spin")} aria-hidden />
              <span>Retry</span>
            </button>
          )}
          <button type="button" onClick={() => window.location.reload()} className={button}>
            <RefreshCw className="size-3" aria-hidden />
            <span>Reload</span>
          </button>
        </div>
      </div>
    </Card>
  );
}

type CardErrorBoundaryProps = CardBoundaryProps & { children?: ReactNode };
type CardErrorBoundaryState = { error: unknown; failed: boolean };

export class CardBoundary extends Component<CardErrorBoundaryProps, CardErrorBoundaryState> {
  override state: CardErrorBoundaryState = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown): CardErrorBoundaryState {
    return { error, failed: true };
  }

  private readonly reset = () => this.setState({ error: null, failed: false });

  override render() {
    const { error, failed } = this.state;
    if (failed) {
      const { children, ...props } = this.props;
      void children;
      return <CardFault {...props} error={error} reset={this.reset} />;
    }
    return <Activity mode="visible">{this.props.children}</Activity>;
  }
}

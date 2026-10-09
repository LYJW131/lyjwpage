import type { CSSProperties, ReactNode } from "react";

import { StatusDot, type DotTone } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";

export function Card({
  id,
  label,
  tone,
  action,
  children,
  className,
  style,
  "data-sentry-mask": sentryMask,
}: {
  id?: string;
  label?: string;
  tone?: DotTone;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  "data-sentry-mask"?: true;
}) {
  return (
    <div
      id={id}
      style={style}
      data-sentry-mask={sentryMask}
      className={cn(
        "paper-card relative flex flex-col overflow-hidden rounded-lg border border-line-strong bg-surface",
        className,
      )}
    >
      {(label || action) && (
        <div className="flex min-h-9 items-center justify-between gap-2 border-b border-line bg-muted px-3 py-2">
          <div className="flex items-center gap-2">
            {tone && <StatusDot tone={tone} />}
            {label && <span className="label-mono text-muted-foreground">{label}</span>}
          </div>
          {action && (
            <div className="label-mono text-muted-foreground shrink-0">{action}</div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

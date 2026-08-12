import type { ReactNode } from "react";

import { StatusDot, type DotTone } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";

/**
 * bento 网格里的卡片。层次靠 1px 边框 + 表面色阶，不用阴影和磨砂。
 */
export function Card({
  id,
  label,
  tone,
  action,
  children,
  className,
}: {
  id?: string;
  /** 左上角等宽小字，如 CHARGER / NOW PLAYING */
  label?: string;
  /** 有 tone 就在标注左侧点一盏灯 */
  tone?: DotTone;
  /** 右上角补充信息 */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      id={id}
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

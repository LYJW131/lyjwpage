import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * 版式骨架：内容居中在容器里，但分隔线横贯整个视口。
 * 这是整套「技术图纸」观感的来源。
 */
export function Section({
  id,
  label,
  title,
  note,
  children,
  className,
}: {
  id?: string;
  /** 左上角的等宽小字标注，如 FIG_002 */
  label?: string;
  title?: string;
  /** 标题右侧的补充说明 */
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("screen-line-top px-4 py-10 sm:py-14", className)}>
      {(label || title) && (
        <header className="mb-6 flex items-baseline justify-between gap-4">
          <div className="flex items-baseline gap-3">
            {label && <span className="label-mono text-muted-foreground">{label}</span>}
            {title && (
              <h2 className="text-lg font-medium tracking-tight sm:text-xl">{title}</h2>
            )}
          </div>
          {note && <div className="label-mono text-muted-foreground shrink-0">{note}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** section 之间的 45° 斜条纹分隔条 */
export function StripeDivider() {
  return (
    <div className="screen-line-top screen-line-bottom relative h-8">
      <div className="stripe-divider absolute inset-0" />
    </div>
  );
}

/** 页面主容器：两侧 1px 竖线把内容框住 */
export function Container({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-5xl border-x border-line",
        className,
      )}
    >
      {children}
    </div>
  );
}

import type { ReactNode } from "react";

import { PsPlusMark } from "@/components/trophies/ps-plus";
import { plusCatalog } from "@/lib/playstation-entitlements";
import { cn } from "@/lib/utils";

/** 奖杯标题的 platform 字段，跨世代收成一枚「PS4/5」。 */
export function consoleLabel(platforms: Array<string | null | undefined>): string | null {
  let ps4 = false;
  let ps5 = false;
  for (const raw of platforms) {
    const value = raw?.toUpperCase() ?? "";
    if (value.includes("PS5")) ps5 = true;
    if (value.includes("PS4")) ps4 = true;
  }
  if (ps4 && ps5) return "PS4/5";
  if (ps5) return "PS5";
  if (ps4) return "PS4";
  return null;
}

function BoxMark({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-0.5 border border-line px-0.5 py-px font-mono text-[10px] leading-none tracking-wide text-muted-foreground uppercase">
      {children}
    </span>
  );
}

/** 官方那种描边小标：平台一枚，Plus 库再跟一枚。自己占一行。 */
export function PlatformMarks({
  platforms,
  service,
  className,
}: {
  platforms: Array<string | null | undefined>;
  service?: string | null;
  className?: string;
}) {
  const console = consoleLabel(platforms);
  const plus = plusCatalog(service);
  if (!console && !plus) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {console ? <BoxMark>{console}</BoxMark> : null}
      {plus ? (
        <BoxMark>
          <PsPlusMark decorative className="h-2.5 w-2.5" />
          PS Plus
        </BoxMark>
      ) : null}
    </div>
  );
}

export function GameFlags({
  service,
  preOrder,
  plain = false,
  className,
}: {
  service: string | null | undefined;
  preOrder?: boolean;
  /** 跟旁边的正文同一字号，不用等宽小标。 */
  plain?: boolean;
  className?: string;
}) {
  const plus = plusCatalog(service);
  if (!preOrder && !plus) return null;
  const label = plain ? undefined : "label-mono";
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      {preOrder ? <span className={cn(label, "text-muted-foreground")}>预购</span> : null}
      {plus ? (
        <span className="inline-flex items-center gap-0.5 text-muted-foreground">
          <PsPlusMark decorative className="h-3 w-3" />
          <span className={label}>Plus 库</span>
        </span>
      ) : null}
    </span>
  );
}

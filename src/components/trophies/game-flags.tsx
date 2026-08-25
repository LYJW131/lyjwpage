import { PsPlusMark } from "@/components/trophies/ps-plus";
import { plusCatalog } from "@/lib/playstation-entitlements";
import { cn } from "@/lib/utils";

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

import { cn } from "@/lib/utils";

export type DotTone = "live" | "idle" | "off";

const TONE_CLASS: Record<DotTone, string> = {
  live: "bg-live",
  idle: "bg-live-idle",
  off: "bg-live-off",
};

/**
 * 数据新鲜度指示灯。只有 live 会呼吸 —— 离线状态不该有动效来吸引注意力。
 */
export function StatusDot({
  tone = "off",
  className,
}: {
  tone?: DotTone;
  className?: string;
}) {
  return (
    <span className={cn("relative flex size-1.5 shrink-0", className)}>
      {tone === "live" && (
        <span
          className="absolute inset-0 rounded-full bg-live [animation:pulse-ring_2s_cubic-bezier(0.4,0,0.6,1)_infinite]"
          aria-hidden
        />
      )}
      <span className={cn("relative size-1.5 rounded-full", TONE_CLASS[tone])} />
    </span>
  );
}

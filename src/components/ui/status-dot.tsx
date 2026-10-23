import { cn } from "@/lib/utils";

export type DotTone = "live" | "idle" | "off" | "alert";

const TONE_CLASS: Record<DotTone, string> = {
  live: "bg-live",
  idle: "bg-live-idle",
  off: "bg-live-off",
  alert: "bg-signal-red",
};

export function StatusDot({
  tone = "off",
  className,
}: {
  tone?: DotTone;
  className?: string;
}) {
  return (
    <span className={cn("relative flex size-1.5 shrink-0", className)}>
      {(tone === "live" || tone === "alert") && (
        <span
          className={cn(
            "absolute inset-0 rounded-full [animation:pulse-ring_2s_cubic-bezier(0.4,0,0.6,1)_infinite]",
            TONE_CLASS[tone],
          )}
          aria-hidden
        />
      )}
      <span className={cn("relative size-1.5 rounded-full", TONE_CLASS[tone])} />
    </span>
  );
}

import Image from "@/components/app-image";
import type { TrophyType } from "@/lib/types";
import { cn } from "@/lib/utils";

const LABELS: Record<TrophyType | "level", string> = {
  platinum: "Platinum",
  gold: "Gold",
  silver: "Silver",
  bronze: "Bronze",
  level: "Trophy level",
};

/**
 * PS5 系统那套四色杯子和等级徽章。官方公开渠道没有对应 SVG，
 * 是按展示尺寸压过的 PNG，走 unoptimized。
 */
export function TrophyMetal({
  kind,
  size = "md",
  className,
}: {
  kind: TrophyType | "level";
  size?: "sm" | "md";
  className?: string;
}) {
  const file = size === "sm" && kind !== "level" ? `${kind}-sm.png` : `${kind}.png`;
  const px = size === "sm" ? 18 : kind === "level" ? 44 : 36;
  return (
    <Image
      src={`/trophies/${file}`}
      alt={LABELS[kind]}
      width={px}
      height={px}
      unoptimized
      className={cn("shrink-0 object-contain", className)}
    />
  );
}

export function trophyTypeLabel(type: TrophyType): string {
  return LABELS[type];
}

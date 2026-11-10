"use client";

import { FABLE_WEEKLY_SHARE_PERCENT, isFableLimit, weeklyLimit } from "@/components/live/vibecoding/limits";
import { forecastWithCard, type LimitForecast } from "@/lib/limit-forecast";
import { cn } from "@/lib/utils";
import type { VibeCodingLimit } from "@shared/types";
import type { ClaudeResetCards } from "@shared/vibecoding-limits";

export type ResetCardKind = keyof ClaudeResetCards;

export type ResetCardScenario = {
  kind: ResetCardKind;
  label: string;
  count: number;
  fromPercent: number;
  forecast: LimitForecast;
};

const CARD_LABELS: Record<ResetCardKind, string> = { fable: "Fable card", standard: "Weekly card" };

// 周额度在卡后的读数。Fable 卡退回本周 Fable 用掉的那部分：Fable 条满格折合周额度的 FABLE_WEEKLY_SHARE_PERCENT。
function percentAfter(kind: ResetCardKind, forecast: LimitForecast, limits: VibeCodingLimit[]) {
  if (kind === "standard") return 0;
  const fable = limits.find(isFableLimit);
  const fableUsed = fable && fable.resetsAt != null && fable.resetsAt * 1000 > forecast.now ? fable.usedPercent : 0;
  return forecast.usedPercent - (fableUsed * FABLE_WEEKLY_SHARE_PERCENT) / 100;
}

export function resetCardScenarios(
  forecast: LimitForecast | null,
  limits: VibeCodingLimit[],
  cards: ClaudeResetCards | null,
): ResetCardScenario[] {
  if (!forecast || !cards) return [];
  return (["fable", "standard"] as const)
    .filter((kind) => cards[kind] > 0 && (kind !== "fable" || limits.some(isFableLimit)))
    .map((kind) => ({
      kind,
      label: CARD_LABELS[kind],
      count: cards[kind],
      fromPercent: forecast.usedPercent,
      forecast: forecastWithCard(forecast, percentAfter(kind, forecast, limits)),
    }));
}

// 限额条跟着选的卡走：两种卡都清空本周 Fable，周额度取卡后的读数。
export function limitsAfterCard(limits: VibeCodingLimit[], scenario: ResetCardScenario | null): VibeCodingLimit[] {
  if (!scenario) return limits;
  const weekly = weeklyLimit({ limits });
  return limits.map((limit) => {
    if (isFableLimit(limit)) return { ...limit, usedPercent: 0 };
    if (limit === weekly) return { ...limit, usedPercent: scenario.forecast.usedPercent };
    return limit;
  });
}

function Option({ label, pressed, onClick }: { label: string; pressed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "label-mono min-h-6 px-2 py-1.5 whitespace-nowrap transition-colors",
        pressed ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

export function ResetCardToggle({
  scenarios,
  selected,
  onSelect,
}: {
  scenarios: ResetCardScenario[];
  selected: ResetCardKind | null;
  onSelect: (kind: ResetCardKind | null) => void;
}) {
  if (!scenarios.length) return null;
  return (
    <div role="group" aria-label="Forecast with a reset card used now" className="flex w-fit divide-x divide-line border border-line">
      <Option label="No card" pressed={selected == null} onClick={() => onSelect(null)} />
      {scenarios.map((scenario) => (
        <Option
          key={scenario.kind}
          label={`${scenario.label} ×${scenario.count}`}
          pressed={selected === scenario.kind}
          onClick={() => onSelect(scenario.kind)}
        />
      ))}
    </div>
  );
}

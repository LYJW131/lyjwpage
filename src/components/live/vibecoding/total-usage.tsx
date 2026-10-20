"use client";

import NumberFlow from "@/components/ui/number-flow";

import { ModelProviderIcon, RankMark } from "@/components/live/vibecoding/marks";
import { FlowDash } from "@/components/ui/flow-dash";
import { describeCodingSources, type CodingSourceNote } from "@/lib/coding-agents";
import type { CodingUsagePayload, CodingUsageTotals } from "@shared/types";
import { cn } from "@/lib/utils";

const TOP_MODELS_SHOWN = 3;

const TOKEN_SEGMENTS = [
  { key: "inputTokens", label: "Input", shortLabel: "IN", color: "oklch(0.63 0.18 250)" },
  { key: "outputTokens", label: "Output", shortLabel: "OUT", color: "oklch(0.68 0.15 175)" },
  {
    key: "cacheReadTokens",
    label: "Cache read",
    shortLabel: "CR",
    color: "oklch(0.72 0.16 75)",
  },
  {
    key: "cacheCreationTokens",
    label: "Cache write",
    shortLabel: "CW",
    color: "oklch(0.65 0.18 315)",
  },
] as const;

function capitalize(part: string) {
  return part ? `${part[0].toUpperCase()}${part.slice(1)}` : part;
}

const MODEL_NAME_ACRONYMS = new Set(["swe", "glm", "oss"]);

function formatModelName(model: string) {
  if (!model) return model;
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/i.exec(model);
  if (claude) {
    const [, family, major, minor] = claude;
    return `Claude ${capitalize(family)} ${major}${minor ? `.${minor}` : ""}`;
  }
  const gpt = /^gpt-(\d+(?:\.\d+)?)(?:-(.+))?$/i.exec(model);
  if (gpt) {
    const [, version, variant] = gpt;
    const suffix = variant ? ` ${variant.split("-").map(capitalize).join(" ")}` : "";
    return `GPT ${version}${suffix}`;
  }
  return model
    .split("-")
    .map((part) => (MODEL_NAME_ACRONYMS.has(part.toLowerCase()) ? part.toUpperCase() : capitalize(part)))
    .join(" ")
    .replace(/\b([A-Z]{2,}) (\d)/, "$1-$2");
}

export function SourceIssue({ failing, hasValue }: { failing: CodingSourceNote[]; hasValue: boolean }) {
  if (failing.length === 0) return null;
  return (
    <span className="text-live-idle-ink">
      <span aria-hidden className="mx-1.5">
        ·
      </span>
      {hasValue ? "Partial" : "Unavailable"}
    </span>
  );
}

export function TotalUsage({
  totals,
  topModels,
  failing,
}: {
  totals: CodingUsageTotals;
  topModels: CodingUsagePayload["topModels"];
  failing: CodingSourceNote[];
}) {
  const values = {
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheCreationTokens: totals.cacheCreationTokens,
  };
  const stackTotal = Object.values(values).reduce((sum, value) => sum + value, 0);

  return (
    <div
      className={cn(
        "border-b border-line px-4 pt-5 lg:px-5",
        topModels.length === 0 && "pb-5",
      )}
    >
      <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
        <div>
          <div className="label-mono text-muted-foreground" title={describeCodingSources(failing) || undefined}>
            Tokens
            <SourceIssue failing={failing} hasValue />
          </div>
          <div className="mt-2 text-3xl font-medium tracking-tight md:text-4xl">
            <NumberFlow
              value={totals.totalTokens}
              locales="en-US"
              format={{ notation: "compact", maximumFractionDigits: 1 }}
            />
          </div>
        </div>
        <div title="At public API prices">
          <div className="label-mono text-muted-foreground">Cost</div>
          <div className="mt-2 text-3xl font-medium tracking-tight md:text-4xl">
            {totals.costComplete || totals.apiEquivalentCostUSD > 0 ? (
              <NumberFlow
                value={totals.apiEquivalentCostUSD}
                locales="en-US"
                format={{
                  style: "currency",
                  currency: "USD",
                  notation: "compact",
                  maximumFractionDigits: 1,
                }}
              />
            ) : <FlowDash />}
          </div>
        </div>
        <div>
          <div className="label-mono text-muted-foreground">Active</div>
          <div className="mt-2 text-3xl font-medium tracking-tight md:text-4xl">
            <NumberFlow value={totals.activeDays} locales="en-US" />
          </div>
        </div>
        <div>
          <div className="label-mono text-muted-foreground">Sessions</div>
          <div className="mt-2 text-3xl font-medium tracking-tight md:text-4xl">
            {totals.sessionCount != null ? <NumberFlow value={totals.sessionCount} locales="en-US" /> : <FlowDash />}
          </div>
        </div>
      </div>

      <div className="mt-6 flex h-2 overflow-hidden bg-muted" aria-hidden>
        {TOKEN_SEGMENTS.map((segment) => {
          const value = values[segment.key];
          return value > 0 ? (
            <span
              key={segment.key}
              style={{
                width: `${(value / Math.max(stackTotal, 1)) * 100}%`,
                backgroundColor: segment.color,
              }}
            />
          ) : null;
        })}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 md:flex md:flex-wrap md:gap-x-5">
        {TOKEN_SEGMENTS.map((segment) => (
          <div key={segment.key} className="flex items-center gap-1.5 text-xs md:gap-2">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: segment.color }}
              aria-hidden
            />
            <span className="text-muted-foreground md:hidden">{segment.shortLabel}</span>
            <span className="hidden text-muted-foreground md:inline">{segment.label}</span>
            <span className="font-mono">
              <NumberFlow
                value={values[segment.key]}
                locales="en-US"
                format={{ notation: "compact", maximumFractionDigits: 1 }}
              />
            </span>
          </div>
        ))}
      </div>

      {topModels.length > 0 && (
        <div className="mt-3 border-t border-line md:py-3">
          <div className="grid divide-y divide-line md:grid-cols-3 md:divide-x md:divide-y-0">
            {topModels.slice(0, TOP_MODELS_SHOWN).map((item, index) => (
              <div
                key={item.model}
                className="flex min-w-0 items-center gap-3 py-3 md:px-4 md:py-0 md:first:pl-0 md:last:pr-0"
              >
                <RankMark rank={index} />
                <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <ModelProviderIcon model={item.model} label={formatModelName(item.model)} />
                    <div className="truncate text-sm font-medium" title={item.model}>
                      {formatModelName(item.model)}
                    </div>
                  </div>
                  <div className="shrink-0 font-mono text-xs text-muted-foreground">
                    <NumberFlow
                      value={item.tokens}
                      locales="en-US"
                      format={{ notation: "compact", maximumFractionDigits: 1 }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

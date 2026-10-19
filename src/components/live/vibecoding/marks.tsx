"use client";

import AnthropicIcon from "@lobehub/icons/es/Anthropic/components/Mono";
import AntigravityColor from "@lobehub/icons/es/Antigravity/components/Color";
import CursorIcon from "@lobehub/icons/es/Cursor/components/Mono";
import DevinIcon from "@lobehub/icons/es/Devin/components/Mono";
import GrokIcon from "@lobehub/icons/es/Grok/components/Mono";
import OpenAIIcon from "@lobehub/icons/es/OpenAI/components/Mono";
import { Cloud } from "lucide-react";
import type { ComponentType } from "react";
import { MODEL_ICON_MAPPINGS, MODEL_ICONS_VERSION } from "virtual:model-icons";

import { ClaudeSpinner } from "@/components/live/claude-spinner";
import { CodexActivityIndicator, CodexMark } from "@/components/live/codex-activity-indicator";
import { MacBookProIcon } from "@/components/ui/device-icons";
import { codingSourceLabel, codingSourceOnMac, type CodingActivityEntry, type CodingAgentRow } from "@/lib/coding-agents";
import { modelIconResolver, modelIconUrl, type BundledModelIcon } from "@/lib/model-icon";
import { cn } from "@/lib/utils";

export function ActiveBadge({ id, sources }: { id: string; sources: CodingActivityEntry["source"][] }) {
  const labels = sources.map((source) => codingSourceLabel(id, source));
  return (
    <span
      className="flex shrink-0 items-center gap-1 text-live-ink"
      title={labels.length ? `Active on ${labels.join(" + ")}` : undefined}
    >
      <span className="label-mono">Active</span>
      {sources.map((source, index) =>
        codingSourceOnMac(id, source) ? (
          <MacBookProIcon key={source} className="size-3.5" aria-label={labels[index]} />
        ) : (
          <Cloud key={source} className="size-3.5" aria-label={labels[index]} />
        ),
      )}
    </span>
  );
}

export function BrandMark({
  icon,
  label,
  className,
}: {
  icon: string;
  label: string;
  className?: string;
}) {
  switch (icon) {
    case "cursor":
      return <CursorIcon size={20} className={className} />;
    case "antigravity":
      return <AntigravityColor size={20} className={className} />;
    case "grok":
      return <GrokIcon size={20} className={className} />;
    case "devin":
      return <DevinIcon size={20} className={className} />;
    case "openai":
    case "codex":
      return <CodexMark className={className} />;
    default:
      return (
        <span
          className={cn(
            "flex items-center justify-center text-xs font-medium text-muted-foreground",
            className,
          )}
        >
          {label.slice(0, 1).toUpperCase()}
        </span>
      );
  }
}

type ModelIconComponent = ComponentType<{ size?: number | string; className?: string }>;

const modelIconOf = modelIconResolver(MODEL_ICON_MAPPINGS);

const BUNDLED_MODEL_ICONS: Record<BundledModelIcon, ModelIconComponent> = {
  Anthropic: AnthropicIcon,
  Cursor: CursorIcon,
  Devin: DevinIcon,
  Grok: GrokIcon,
  OpenAI: OpenAIIcon,
};

function ModelIconMark({ icon, label }: { icon: string | null; label: string }) {
  if (icon && Object.hasOwn(BUNDLED_MODEL_ICONS, icon)) {
    const Icon = BUNDLED_MODEL_ICONS[icon as BundledModelIcon];
    return <Icon size={16} />;
  }
  if (icon) {
    const mask = `url(${modelIconUrl(icon, MODEL_ICONS_VERSION)}) center / contain no-repeat`;
    return <span className="size-4 bg-current" style={{ mask, WebkitMask: mask }} />;
  }
  return (
    <span className="flex size-4 items-center justify-center border border-line text-2xs font-medium leading-none text-muted-foreground">
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function ModelProviderIcon({ model, label }: { model: string; label: string }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center text-foreground" aria-hidden>
      <ModelIconMark icon={modelIconOf(model)} label={label} />
    </span>
  );
}

const RANK_MARK_COLOR = [
  "oklch(0.65 0.144 33.6)",
  "oklch(0.696 0.105 52)",
  "oklch(0.777 0.099 85.5)",
] as const;

export function RankMark({ rank }: { rank: number }) {
  return (
    <span
      className="shrink-0 font-mono text-sm font-bold tracking-[0.02em] text-muted-foreground"
      style={
        rank < RANK_MARK_COLOR.length
          ? { color: RANK_MARK_COLOR[rank] }
          : undefined
      }
    >
      {String(rank + 1).padStart(2, "0")}
    </span>
  );
}

export function FeaturedMark({ row, active }: { row: Pick<CodingAgentRow, "id" | "icon" | "label">; active: boolean }) {
  if (row.id === "claude") return <ClaudeSpinner active={active} />;
  if (active) return <CodexActivityIndicator active />;
  return (
    <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
      {row.icon === "cursor" ? <CursorIcon size={18} /> : <BrandMark icon={row.icon} label={row.label} className="size-5" />}
    </span>
  );
}

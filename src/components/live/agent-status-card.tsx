"use client";

import AnthropicIcon from "@lobehub/icons/es/Anthropic/components/Mono";
import AntigravityColor from "@lobehub/icons/es/Antigravity/components/Color";
import CursorIcon from "@lobehub/icons/es/Cursor/components/Mono";
import GrokIcon from "@lobehub/icons/es/Grok/components/Mono";
import { ExternalLink, X } from "lucide-react";
import { useCallback, useId, useState } from "react";

import { CodexMark } from "@/components/live/codex-activity-indicator";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useStatus } from "@/hooks/use-status";
import {
  indicatorLabel,
  type AgentIndicator,
  type AgentStatusPayload,
  type AgentStatusRow,
} from "@/lib/agent-status-types";
import { AGENT_STATUS_PATH } from "@/lib/paths";
import type { StatusResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

const REFRESH_MS = 60_000;

const checkedAt = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  hour: "numeric",
  minute: "2-digit",
});

const incidentAt = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function indicatorDot(indicator: AgentIndicator): string {
  switch (indicator) {
    case "operational":
      return "bg-[oklch(0.65_0.17_145)]";
    case "degraded":
    case "maintenance":
      return "bg-[oklch(0.72_0.16_75)]";
    case "partial_outage":
    case "major_outage":
      return "bg-[oklch(0.62_0.21_25)]";
    default:
      return "bg-muted-foreground";
  }
}

function indicatorText(indicator: AgentIndicator): string {
  switch (indicator) {
    case "degraded":
    case "maintenance":
      return "text-[oklch(0.72_0.16_75)]";
    case "partial_outage":
    case "major_outage":
      return "text-[oklch(0.62_0.21_25)]";
    case "unavailable":
    case "unmonitored":
      return "text-muted-foreground";
    default:
      return "text-foreground";
  }
}

function Brand({ id }: { id: AgentStatusRow["id"] }) {
  const className = "text-foreground";
  switch (id) {
    case "claude":
      return <AnthropicIcon size={20} className={className} />;
    case "codex":
      return <CodexMark />;
    case "cursor":
      return <CursorIcon size={20} className={className} />;
    case "grok":
      return <GrokIcon size={20} className={className} />;
    case "antigravity":
      return <AntigravityColor size={20} />;
  }
}

function formatWhen(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return incidentAt.format(parsed);
}

function Detail({ agent, onClose }: { agent: AgentStatusRow; onClose: () => void }) {
  const titleId = useId();
  const label = indicatorLabel(agent.indicator);
  return (
    <Modal titleId={titleId} onClose={onClose} className="max-w-md">
      <header className="flex items-center justify-between gap-2 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0" aria-hidden>
            <Brand id={agent.id} />
          </span>
          <h2 id={titleId} className="truncate text-sm font-medium">
            {agent.name}
          </h2>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </header>
      <div className="max-h-[70vh] overflow-y-auto px-4 pt-3 pb-4 scrollbar-none [&::-webkit-scrollbar]:hidden">
        <p className={cn("text-sm", indicatorText(agent.indicator))}>{label}</p>
        {agent.note && <p className="mt-2 text-sm text-muted-foreground">{agent.note}</p>}
        {agent.stale && (
          <p className="mt-2 text-sm text-muted-foreground">
            The last check failed. Showing the previous result.
          </p>
        )}
        {agent.components.some((component) => component.indicator !== "operational") && (
          <ul className="mt-4 grid divide-y divide-line border-y border-line">
            {agent.components.map((component) => (
              <li key={component.name} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate">{component.name}</span>
                <span className={cn("shrink-0", indicatorText(component.indicator))}>
                  {indicatorLabel(component.indicator)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {agent.incidents.length > 0 ? (
          <ul className="mt-4 grid gap-4">
            {agent.incidents.map((incident) => {
              const when = formatWhen(incident.updatedAt);
              return (
                <li key={incident.id}>
                  <a href={incident.url} target="_blank" rel="noreferrer" className="text-sm font-medium hover:underline">
                    {incident.title}
                  </a>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {incident.status}
                    {when ? ` · ${when} UTC+8` : ""}
                  </p>
                  {incident.body && <p className="mt-1 text-sm text-muted-foreground">{incident.body}</p>}
                </li>
              );
            })}
          </ul>
        ) : (
          agent.indicator !== "unmonitored" && (
            <p className="mt-4 text-sm text-muted-foreground">No active incidents.</p>
          )
        )}
      </div>
      <a
        href={agent.statusUrl}
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-center gap-1.5 border-t border-line py-2.5 text-sm hover:bg-surface-hover"
      >
        Open status page
        <ExternalLink className="size-3.5" aria-hidden />
      </a>
    </Modal>
  );
}

export function AgentStatusCard({
  fallback,
  className,
}: {
  fallback: StatusResponse<AgentStatusPayload>;
  className?: string;
}) {
  useLiveEvents();
  const { data, error } = useStatus<AgentStatusPayload>(AGENT_STATUS_PATH, REFRESH_MS, { fallback });
  const [openId, setOpenId] = useState<AgentStatusRow["id"] | null>(null);
  const close = useCallback(() => setOpenId(null), []);
  const open = data?.agents.find((agent) => agent.id === openId) ?? null;
  const checked = data ? checkedAt.format(data.fetchedAt) : null;

  return (
    <Card
      id="agent-status"
      label="AGENT STATUS"
      className={cn("md:col-span-2", className)}
      action={checked ? <span title={`${checked} UTC+8`}>{checked}</span> : undefined}
    >
      {data ? (
        <ul className="grid divide-y divide-line">
          {data.agents.map((agent) => {
            const label = indicatorLabel(agent.indicator);
            return (
              <li key={agent.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(agent.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-hover md:px-5"
                >
                  <span className="shrink-0" aria-hidden>
                    <Brand id={agent.id} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{agent.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {agent.stale && <span className="text-xs text-muted-foreground">cached</span>}
                    <span className={cn("size-1.5 rounded-full", indicatorDot(agent.indicator))} aria-hidden />
                    <span className={cn("text-sm", indicatorText(agent.indicator))}>{label}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-4 py-5 text-sm text-muted-foreground md:px-5">
          {error ? "Status unavailable" : "Checking status"}
        </p>
      )}
      {open && <Detail agent={open} onClose={close} />}
    </Card>
  );
}

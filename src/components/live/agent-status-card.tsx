"use client";

import ClaudeIcon from "@lobehub/icons/es/Claude/components/Color";
import CloudflareIcon from "@lobehub/icons/es/Cloudflare/components/Color";
import DeepSeekIcon from "@lobehub/icons/es/DeepSeek/components/Color";
import CursorIcon from "@lobehub/icons/es/Cursor/components/Mono";
import GithubIcon from "@lobehub/icons/es/Github/components/Mono";
import GrokIcon from "@lobehub/icons/es/Grok/components/Mono";
import OpenAIIcon from "@lobehub/icons/es/OpenAI/components/Mono";
import VercelIcon from "@lobehub/icons/es/Vercel/components/Mono";
import { ExternalLink, X } from "lucide-react";
import { useCallback, useId, useState } from "react";

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
      return <ClaudeIcon size={20} />;
    case "codex":
      return <OpenAIIcon size={20} className={className} />;
    case "cursor":
      return <CursorIcon size={20} className={className} />;
    case "grok":
      return <GrokIcon size={20} className={className} />;
    case "deepseek":
      return <DeepSeekIcon size={20} />;
    case "vercel":
      return <VercelIcon size={20} className={className} />;
    case "github":
      return <GithubIcon size={20} className={className} />;
    case "cloudflare":
      return <CloudflareIcon size={20} />;
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
  /** 只列有异常的组件，最多六行。 */
  const troubled = agent.components.filter((component) => component.indicator !== "operational");
  const shown = troubled.slice(0, 6);
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
        {troubled.length > 0 && (
          <ul className="mt-4 grid divide-y divide-line border-y border-line">
            {shown.map((component) => (
              <li key={component.name} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate">{component.name}</span>
                <span className={cn("shrink-0", indicatorText(component.indicator))}>
                  {indicatorLabel(component.indicator)}
                </span>
              </li>
            ))}
            {troubled.length > shown.length && (
              <li className="py-2 text-sm text-muted-foreground">+{troubled.length - shown.length} more</li>
            )}
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
                  {incident.body && !/scheduled|planned/i.test(incident.status) && (
                    <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{incident.body}</p>
                  )}
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
  /**
   * 两列各四行：桌面并排，移动端一个视口一列，靠 scroll-snap 左右滑切换。
   * 纯 CSS 滑动，不引轮播库。
   */
  const columns = data
    ? [data.agents.slice(0, 4), data.agents.slice(4)].filter((column) => column.length > 0)
    : [];

  return (
    <Card
      id="agent-status"
      label="PROVIDER STATUS"
      className={cn("md:col-span-2", className)}
      action={checked ? <span title={`${checked} UTC+8`}>{checked}</span> : undefined}
    >
      {data ? (
        <div className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain scrollbar-none md:grid md:grid-cols-2 md:divide-x md:divide-line md:overflow-visible [&::-webkit-scrollbar]:hidden">
          {columns.map((column) => (
            <ul
              key={column[0]?.id ?? "column"}
              className="min-w-full shrink-0 snap-center divide-y divide-line md:min-w-0"
            >
              {column.map((agent) => {
                const label = indicatorLabel(agent.indicator);
                return (
                  <li key={agent.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(agent.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-hover md:px-3"
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
          ))}
        </div>
      ) : (
        <p className="px-4 py-5 text-sm text-muted-foreground md:px-5">
          {error ? "Status unavailable" : "Checking status"}
        </p>
      )}
      {open && <Detail agent={open} onClose={close} />}
    </Card>
  );
}

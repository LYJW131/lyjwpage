"use client";

import CloudflareIcon from "@lobehub/icons/es/Cloudflare/components/Color";

import { elapsed, useNow } from "@/components/live/focus-now-card";
import { NowReveal } from "@/components/live/now-reveal";
import { Card } from "@/components/ui/card";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useStale } from "@/hooks/use-stale";
import { useStatus } from "@/hooks/use-status";
import type { AgentStatusPayload } from "@shared/agent-status-types";
import { AGENT_STATUS_STALE_MS } from "@shared/freshness";
import { AGENT_STATUS_PATH } from "@/lib/paths";
import type { StatusResponse } from "@shared/types";

function Outage({ affected, since }: { affected: string; since: number }) {
  const now = useNow();
  return (
    <div className="flex min-h-11 items-center gap-3 p-4 sm:gap-4 md:gap-2 md:px-4 md:py-2 lg:px-5">
      <CloudflareIcon size={20} className="size-7 shrink-0 md:size-5" />
      <div className="flex min-w-0 flex-1 flex-col gap-1 md:flex-row md:items-center md:gap-2">
        <div className="truncate text-base font-semibold text-signal-red sm:text-lg leading-tight md:shrink-0 md:text-sm md:font-medium">
          Cloudflare Outage
        </div>
        <div className="truncate text-sm text-muted-foreground">
          <span className="hidden md:inline">· </span>
          {affected}
        </div>
      </div>
      <span
        className="shrink-0 text-xl font-medium leading-none sm:text-3xl md:text-sm"
        suppressHydrationWarning
      >
        {elapsed(Math.max(0, now - since))}
      </span>
    </div>
  );
}

export function CloudflareOutageRow({ fallback }: { fallback: StatusResponse<AgentStatusPayload> }) {
  useLiveEvents();
  const { data, servedAt } = useStatus<AgentStatusPayload>(AGENT_STATUS_PATH, { fallback });
  const stale = useStale(data?.fetchedAt, AGENT_STATUS_STALE_MS, servedAt);
  const found = data?.agents.find((agent) => agent.id === "cloudflare");
  const row = stale || found?.stale ? undefined : found;
  const since = row?.indicator === "major_outage" ? row.outageSince : undefined;
  const affected =
    row?.components
      .filter((component) => component.indicator === "major_outage")
      .map((component) => component.name)
      .join(", ");

  return (
    <NowReveal revealKey="cloudflare-outage">
      {since != null ? (
        <Card id="cloudflare-outage" className="scroll-mt-28">
          <Outage affected={affected || "Services degraded"} since={since} />
        </Card>
      ) : null}
    </NowReveal>
  );
}

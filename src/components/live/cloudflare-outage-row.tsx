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
    <div className="flex flex-col items-center gap-1 p-4 text-center md:py-3 lg:px-5">
      <div className="flex max-w-full items-center gap-2 text-base font-semibold leading-tight sm:text-lg">
        <CloudflareIcon size={20} className="size-6 shrink-0" />
        <span className="truncate">
          Cloudflare <span className="text-signal-red">Outage</span>
        </span>
        <span className="shrink-0 font-normal text-muted-foreground" aria-hidden>
          ·
        </span>
        <span className="shrink-0 text-signal-red" suppressHydrationWarning>
          {elapsed(Math.max(0, now - since))}
        </span>
      </div>
      <div className="flex max-w-full flex-col items-center gap-1 text-sm text-muted-foreground md:flex-row md:gap-2">
        <span className="shrink-0">Some features may not work</span>
        <span className="hidden md:inline" aria-hidden>
          ·
        </span>
        <span className="max-w-full truncate">{affected}</span>
      </div>
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
    <NowReveal revealKey="cloudflare-outage" top>
      {since != null ? (
        <Card id="cloudflare-outage" className="alert-card scroll-mt-28">
          <Outage affected={affected || "Services degraded"} since={since} />
        </Card>
      ) : null}
    </NowReveal>
  );
}

"use client";

import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { useStale } from "@/hooks/use-stale";
import { useStatus } from "@/hooks/use-status";
import { GENSHIN_STALE_MS } from "@/lib/freshness";
import { abyssLabel } from "@/lib/genshin";
import { STATUS_VIEWS } from "@/lib/status-views";
import type { StatusResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { GenshinProfile } from "@shared/lag";

const count = new Intl.NumberFormat("en-US");

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="label-mono truncate text-muted-foreground">{label}</div>
      <div className="font-mono text-lg tabular-nums">{children}</div>
    </div>
  );
}

export function GenshinCard({
  fallback,
  className,
}: {
  fallback: StatusResponse<GenshinProfile>;
  className?: string;
}) {
  const { data, updatedAt, servedAt } = useStatus<GenshinProfile>(STATUS_VIEWS.genshin.path, { fallback });
  const stale = useStale(updatedAt, GENSHIN_STALE_MS, servedAt);
  if (!data) return null;

  return (
    <Card
      id="genshin"
      label="Genshin Impact"
      action={stale ? "Unavailable" : "Enka.Network"}
      className={cn("scroll-mt-28", className)}
    >
      <div className="flex flex-col gap-3 p-4 lg:p-5">
        <div className="truncate font-medium" title={data.nickname}>
          {data.nickname || <span className="text-muted-foreground">—</span>}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Adventure Rank">{data.adventureRank}</Stat>
          <Stat label="World Level">{data.worldLevel}</Stat>
          <Stat label="Achievements">{count.format(data.achievements)}</Stat>
          <Stat label="Spiral Abyss">{abyssLabel(data.abyss)}</Stat>
          {data.theaterAct != null && <Stat label="Theater">Act {data.theaterAct}</Stat>}
        </div>
      </div>
    </Card>
  );
}

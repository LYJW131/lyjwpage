"use client";

import { Card } from "@/components/ui/card";
import { useStale } from "@/hooks/use-stale";
import { useStatus } from "@/hooks/use-status";
import { DIGEST_PATH } from "@/lib/paths";
import { cn } from "@/lib/utils";
import type { DigestPayload } from "@shared/digest";
import { DIGEST_STALE_MS } from "@shared/freshness";
import { modelLabel } from "@shared/god-chat-tiers";
import type { StatusResponse } from "@shared/types";

const updatedTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  hour: "numeric",
  minute: "2-digit",
});

const updatedDay = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function DigestCard({
  fallback,
  className,
}: {
  fallback: StatusResponse<DigestPayload>;
  className?: string;
}) {
  const { data, updatedAt, servedAt } = useStatus<DigestPayload>(DIGEST_PATH, { fallback });
  const stale = useStale(updatedAt, DIGEST_STALE_MS, servedAt);
  if (!data || !updatedAt) return null;

  return (
    <Card
      id="digest"
      label="In Brief"
      action={`Written by ${modelLabel(data.model)}`}
      className={cn("scroll-mt-28", className)}
    >
      <div className="px-4 py-3.5 md:px-5 md:py-4">
        <p className={cn("text-sm leading-relaxed text-pretty", stale && "text-muted-foreground")}>{data.text}</p>
        <p className="mt-2 text-xs text-muted-foreground" title={`${updatedDay.format(updatedAt)} UTC+8`}>
          {stale ? `Not updated since ${updatedDay.format(updatedAt)}` : `Past 24 hours · updated ${updatedTime.format(updatedAt)}`}
        </p>
      </div>
    </Card>
  );
}

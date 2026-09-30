"use client";

import { useSyncExternalStore } from "react";

import Image from "@/components/app-image";
import { GithubChart } from "@/components/github-chart";
import { VibeYearChart } from "@/components/live/vibe-year-chart";
import { Card } from "@/components/ui/card";
import {
  readHeatmapMode,
  subscribeHeatmap,
  writeHeatmapMode,
} from "@/lib/heatmap-preference";
import { site } from "@/lib/site";
import type {
  CodingYearPayload,
  GithubChartPayload,
  StatusResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export function ContactCard({
  avatarDataUri,
  chartFallback,
  yearFallback,
}: {
  avatarDataUri: string | null;
  chartFallback: StatusResponse<GithubChartPayload>;
  yearFallback: StatusResponse<CodingYearPayload>;
}) {
  const mode = useSyncExternalStore(subscribeHeatmap, readHeatmapMode, () => "tokens");

  return (
    <Card id="contact" className="h-full">
      <div className="flex h-full flex-col justify-between gap-4 p-4 lg:p-5">
        <div className="flex items-center justify-between gap-3 sm:gap-4">
          <div className="flex min-w-0 items-center gap-3 lg:gap-4">
            <a
              href={site.github}
              target="_blank"
              rel="noreferrer noopener"
              className="group relative size-14 shrink-0 overflow-hidden rounded-lg border border-line bg-muted lg:size-16"
            >
              {/* data URI 自动跳过优化；不要全局加 unoptimized，远端回退仍需缩图。 */}
              <Image
                src={avatarDataUri ?? site.githubAvatar}
                alt={`${site.githubLogin}'s GitHub avatar`}
                fill
                sizes="(min-width: 1024px) 64px, 56px"
                className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                /* 内联图同步解码避免首帧闪空；远端回退保留异步解码。 */
                decoding={avatarDataUri ? "sync" : "async"}
              />
            </a>
            <div className="min-w-0">
              <a
                href={site.github}
                target="_blank"
                rel="noreferrer noopener"
                className="-mt-2 block truncate pt-2 text-lg font-bold tracking-tight leading-tight sm:text-xl lg:text-2xl"
              >
                {site.githubLogin}
              </a>
              <a
                href={`mailto:${site.email}`}
                className="-mb-3 mt-1 block truncate pb-3 font-mono text-xs leading-none text-muted-foreground transition-colors hover:text-foreground"
              >
                {site.email}
              </a>
            </div>
          </div>

          <div
            className="flex shrink-0 flex-col divide-y divide-line border border-line"
            role="group"
            aria-label="Heatmap"
          >
            <HeatmapTab
              label="Tokens"
              tab="tokens"
              pressed={mode === "tokens"}
              onClick={() => writeHeatmapMode("tokens")}
            />
            <HeatmapTab
              label="Commit"
              tab="commit"
              pressed={mode === "commit"}
              onClick={() => writeHeatmapMode("commit")}
            />
          </div>
        </div>

        <div className="heatmap-panel w-full" data-heatmap-panel="tokens">
          <VibeYearChart fallback={yearFallback} className="w-full" />
        </div>
        <div className="heatmap-panel w-full" data-heatmap-panel="commit">
          <GithubChart fallback={chartFallback} />
        </div>
      </div>
    </Card>
  );
}

function HeatmapTab({
  label,
  tab,
  pressed,
  onClick,
}: {
  label: string;
  tab: "tokens" | "commit";
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-heatmap-tab={tab}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "heatmap-tab label-mono min-h-6 w-full px-2 py-1.5 text-center text-muted-foreground transition-colors hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

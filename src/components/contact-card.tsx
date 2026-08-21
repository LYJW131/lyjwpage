"use client";

import Image from "next/image";
import { useSyncExternalStore } from "react";

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
  GithubChartPayload,
  StatusResponse,
  VibeCodingYearPayload,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export function ContactCard({
  chartFallback,
  yearFallback,
}: {
  chartFallback: StatusResponse<GithubChartPayload>;
  yearFallback: StatusResponse<VibeCodingYearPayload>;
}) {
  const mode = useSyncExternalStore(subscribeHeatmap, readHeatmapMode, () => "coding");

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
              <Image
                src={site.githubAvatar}
                alt={`${site.githubLogin} 的 GitHub 头像`}
                fill
                sizes="(min-width: 1024px) 64px, 56px"
                className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
              />
            </a>
            <div className="min-w-0">
              <a
                href={site.github}
                target="_blank"
                rel="noreferrer noopener"
                className="block truncate text-lg font-bold tracking-tight leading-tight sm:text-xl lg:text-2xl"
              >
                {site.githubLogin}
              </a>
              <a
                href={`mailto:${site.email}`}
                className="mt-1 block truncate font-mono text-xs leading-none text-muted-foreground transition-colors hover:text-foreground"
              >
                {site.email}
              </a>
            </div>
          </div>

          <div
            className="flex shrink-0 flex-col divide-y divide-line border border-line"
            role="group"
            aria-label="热力图"
          >
            <HeatmapTab
              label="Tokens"
              tab="tokens"
              pressed={mode === "coding"}
              onClick={() => writeHeatmapMode("coding")}
            />
            <HeatmapTab
              label="Commit"
              tab="commit"
              pressed={mode === "github"}
              onClick={() => writeHeatmapMode("github")}
            />
          </div>
        </div>

        {/*
          两张图都进 HTML。进页前 layout 里那段脚本按 localStorage 写
          html[data-heatmap]，CSS 先藏对的那张，水合再慢也不跳。
        */}
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
        "heatmap-tab label-mono w-full px-2 py-1 text-center text-muted-foreground transition-colors hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

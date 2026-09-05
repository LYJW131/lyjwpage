"use client";

import Image from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ArrowUpRight } from "lucide-react";
import { GithubChart } from "@/components/github-chart";
import { VibeYearChart } from "@/components/live/vibe-year-chart";
import {
  readHeatmapMode,
  subscribeHeatmap,
  writeHeatmapMode,
} from "@/lib/heatmap-preference";
import {
  resolveTimezoneDisplay,
  formatTimezoneRegion,
  formatUTCOffset,
} from "@/lib/timezone-display";
import { site } from "@/lib/site";
import type {
  StatusResponse,
  GithubChartPayload,
  VibeCodingYearPayload,
  TimezonePayload,
} from "@/lib/types";

export function SignalProfile({
  avatarDataUri,
  chartFallback,
  yearFallback,
  timezoneFallback,
}: {
  avatarDataUri: string | null;
  chartFallback: StatusResponse<GithubChartPayload>;
  yearFallback: StatusResponse<VibeCodingYearPayload>;
  timezoneFallback: StatusResponse<TimezonePayload>;
}) {
  const mode = useSyncExternalStore(
    subscribeHeatmap,
    readHeatmapMode,
    () => "tokens",
  );
  const [now, setNow] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const at =
    now || (timezoneFallback.ok ? timezoneFallback.data.snapshotAt : 0);
  const timezone = resolveTimezoneDisplay(
    timezoneFallback.ok ? timezoneFallback.data.timezone : null,
    at,
  );
  const time = at
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone.identifier,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).format(at)
    : "—";
  const date = at
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone.identifier,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(at)
    : "—";
  return (
    <div className="profile-exhibit" data-scroll>
      <div className="profile-statement">
        <span className="profile-ghost" aria-hidden="true">
          CONTACT
        </span>
        <span className="micro">THE PERSON BEHIND THE RECORDS</span>
        <h2>
          保持好奇。
          <br />
          一直在路上。
        </h2>
        <div className="profile-identity">
          <Image
            src={avatarDataUri ?? site.githubAvatar}
            alt={site.githubLogin}
            width={64}
            height={64}
            decoding={avatarDataUri ? "sync" : "async"}
          />
          <div>
            <strong>{site.githubLogin}</strong>
            <span>CODE / MUSIC / GAMES / LIFE</span>
          </div>
        </div>
        <a className="contact-line" href={`mailto:${site.email}`}>
          <span>
            EMAIL<big>{site.email}</big>
          </span>
          <ArrowUpRight size={27} />
        </a>
        <a
          className="contact-line"
          href={site.github}
          target="_blank"
          rel="noreferrer noopener"
        >
          <span>
            GITHUB<big>{site.githubLogin}</big>
          </span>
          <ArrowUpRight size={27} />
        </a>
      </div>
      <div className="profile-records">
        <div className="profile-time">
          <span className="micro">
            LOCAL TIME / {formatTimezoneRegion(timezone.identifier)}
          </span>
          <time dateTime={at ? new Date(at).toISOString() : undefined}>
            {time}
          </time>
          <div>
            <span>{date}</span>
            <span>
              {timezone.offsetSeconds != null
                ? formatUTCOffset(timezone.offsetSeconds)
                : ""}
            </span>
          </div>
        </div>
        <div className="profile-calendar">
          <div className="calendar-topline">
            <h3>留下的痕迹</h3>
            <div role="group" aria-label="热力图">
              <button
                data-heatmap-tab="tokens"
                aria-pressed={mode === "tokens"}
                onClick={() => writeHeatmapMode("tokens")}
              >
                TOKENS
              </button>
              <button
                data-heatmap-tab="commit"
                aria-pressed={mode === "commit"}
                onClick={() => writeHeatmapMode("commit")}
              >
                GITHUB
              </button>
            </div>
          </div>
          <div className="heatmap-panel" data-heatmap-panel="tokens">
            <VibeYearChart fallback={yearFallback} className="w-full" />
          </div>
          <div className="heatmap-panel" data-heatmap-panel="commit">
            <GithubChart fallback={chartFallback} />
          </div>
          <span className="micro">A YEAR IN SMALL STEPS</span>
        </div>
      </div>
    </div>
  );
}

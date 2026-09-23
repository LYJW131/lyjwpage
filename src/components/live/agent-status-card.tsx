"use client";

import AppleIcon from "@lobehub/icons/es/Apple/components/Mono";
import ClaudeIcon from "@lobehub/icons/es/Claude/components/Color";
import CloudflareIcon from "@lobehub/icons/es/Cloudflare/components/Color";
import CursorIcon from "@lobehub/icons/es/Cursor/components/Mono";
import GithubIcon from "@lobehub/icons/es/Github/components/Mono";
import GrokIcon from "@lobehub/icons/es/Grok/components/Mono";
import OpenAIIcon from "@lobehub/icons/es/OpenAI/components/Mono";
import VercelIcon from "@lobehub/icons/es/Vercel/components/Mono";
import { ExternalLink, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

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
const ROWS_PER_COLUMN = 3;

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

/** LobeHub 没有 TypeSafe；这是 typesafe.ai 页头的标志，原图 16.487×24，左右补边成方形。 */
function TypesafeIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="-3.7565 0 24 24"
      width={20}
      height={20}
      fill="currentColor"
      className={className}
    >
      <path d="M 12.756 2.928 L 12.756 7.067 L 16.486 9.487 L 16.487 18.652 L 8.244 24 L 3.732 21.073 L 3.732 16.82 L 0 14.399 L 0 5.35 L 0.355 5.118 L 8.244 0 Z M 5.94 20.65 L 8.242 22.144 L 14.275 18.227 L 11.975 16.735 Z M 9.022 10.332 L 9.022 14.4 L 5.29 16.822 L 5.29 19.216 L 11.197 15.383 L 11.197 8.921 Z M 12.756 15.384 L 14.928 16.794 L 14.928 10.332 L 12.756 8.922 Z M 2.21 13.976 L 4.511 15.47 L 6.812 13.976 L 4.512 12.485 Z M 1.559 6.193 L 1.559 12.544 L 3.731 11.134 L 3.731 7.066 L 7.464 4.643 L 7.464 2.36 L 1.56 6.193 Z M 5.291 11.132 L 7.463 12.542 L 7.463 10.332 L 5.292 8.921 L 5.292 11.132 Z M 5.94 7.487 L 8.244 8.981 L 10.544 7.488 L 8.244 5.994 Z M 9.024 4.643 L 11.196 6.054 L 11.196 3.774 L 9.024 2.359 Z" />
    </svg>
  );
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
    case "typesafe":
      return <TypesafeIcon className={className} />;
    case "apple":
      return <AppleIcon size={20} className={className} />;
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

/**
 * 弹窗里有没有比「Operational · No active incidents」更多的东西。
 * 全绿就直接去官方状态页，有事才开弹窗方便快速看。
 */
function hasDetail(agent: AgentStatusRow): boolean {
  return (
    agent.indicator !== "operational" ||
    agent.stale ||
    agent.note !== null ||
    agent.incidents.length > 0 ||
    agent.components.some((component) => component.indicator !== "operational")
  );
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
  const scrollerRef = useRef<HTMLDivElement>(null);
  const hasColumns = Boolean(data?.agents.length);
  /**
   * 没被手动滑过就一直停在第一列：换列数、数据刷新、浏览器恢复滚动位置
   * 或吸附重算把它挪走时都拉回最左。摸到、滚轮横滑或键盘操作过才算手动。
   */
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let touched = false;
    const touch = () => {
      touched = true;
    };
    const touchWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) touched = true;
    };
    const home = () => {
      if (!touched && scroller.scrollLeft !== 0) scroller.scrollTo({ left: 0, behavior: "instant" });
    };
    const observer = new ResizeObserver(home);
    observer.observe(scroller);
    scroller.addEventListener("pointerdown", touch, { passive: true });
    scroller.addEventListener("touchstart", touch, { passive: true });
    scroller.addEventListener("keydown", touch);
    scroller.addEventListener("wheel", touchWheel, { passive: true });
    scroller.addEventListener("scroll", home, { passive: true });
    home();
    return () => {
      observer.disconnect();
      scroller.removeEventListener("pointerdown", touch);
      scroller.removeEventListener("touchstart", touch);
      scroller.removeEventListener("keydown", touch);
      scroller.removeEventListener("wheel", touchWheel);
      scroller.removeEventListener("scroll", home);
    };
  }, [hasColumns]);
  /**
   * 三列各三行，按卡片自己的宽度一次露出 3 / 2 / 1 列，放不下的靠 scroll-snap
   * 左右滑。一列至少约 287px（2 列从卡片宽 36rem 起、3 列从 54rem 起）：
   * 最长的一行是 Cloudflare 加 Partial outage，约 284px。
   * 列间竖线是每列左侧 1px 间隙里的伪元素，跟着内容一起滑，滑到哪一列边上都不会
   * 贴着卡片边框；容器本身不上底色，iOS 横向回弹拉出来的只是卡片本色。
   * 纯 CSS 滑动，不引轮播库。
   */
  const columns: AgentStatusRow[][] = [];
  for (let start = 0; data && start < data.agents.length; start += ROWS_PER_COLUMN) {
    columns.push(data.agents.slice(start, start + ROWS_PER_COLUMN));
  }

  return (
    <Card
      id="agent-status"
      label="PROVIDER STATUS"
      className={cn("md:col-span-2", className)}
      action={checked ? <span title={`${checked} UTC+8`}>{checked}</span> : undefined}
    >
      {data ? (
        <div
          ref={scrollerRef}
          className="@container flex snap-x snap-mandatory gap-px overflow-x-auto overscroll-x-contain scrollbar-none [&::-webkit-scrollbar]:hidden"
        >
          {columns.map((column) => (
            <ul
              key={column[0]?.id ?? "column"}
              className="relative w-full shrink-0 snap-start divide-y divide-line not-first:before:absolute not-first:before:inset-y-0 not-first:before:-left-px not-first:before:w-px not-first:before:bg-line @[36rem]:w-[calc((100%-1px)/2)] @[54rem]:w-[calc((100%-2px)/3)]"
            >
              {column.map((agent) => {
                const label = indicatorLabel(agent.indicator);
                const rowClass =
                  "flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-hover @[36rem]:px-3";
                const row = (
                  <>
                    <span className="shrink-0" aria-hidden>
                      <Brand id={agent.id} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{agent.name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      {agent.stale && <span className="text-xs text-muted-foreground">cached</span>}
                      <span className={cn("size-1.5 rounded-full", indicatorDot(agent.indicator))} aria-hidden />
                      <span className={cn("text-sm", indicatorText(agent.indicator))}>{label}</span>
                    </span>
                  </>
                );
                return (
                  <li key={agent.id}>
                    {hasDetail(agent) ? (
                      <button type="button" onClick={() => setOpenId(agent.id)} className={rowClass}>
                        {row}
                      </button>
                    ) : (
                      <a href={agent.statusUrl} target="_blank" rel="noreferrer" className={rowClass}>
                        {row}
                      </a>
                    )}
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

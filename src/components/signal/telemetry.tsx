"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, ArrowDownRight, ArrowRight } from "lucide-react";
import { incrementalFetcher, useStatus } from "@/hooks/use-status";
import { useLocalCharging } from "@/hooks/use-local-charging";
import { useStale, useReporterStale } from "@/hooks/use-stale";
import { useMountedAt } from "@/hooks/use-mounted-at";
import {
  VIBECODING_PATH,
  SERVER_PATH,
  CHARGER_PATH,
  POWERBANK_PATH,
  ACTIVITY_PATH,
} from "@/lib/paths";
import { fetchVibeCoding, seedVibeCoding } from "@/lib/vibecoding-activity";
import {
  historyCursor,
  mergeChargerHistory,
  seedChargerHistory,
} from "@/lib/charger-history";
import { powerTrace } from "@/lib/signal-presentation";
import { VIBECODING_STALE_MS, SERVER_STALE_MS } from "@/lib/freshness";
import type {
  StatusResponse,
  VibeCodingPayload,
  VibeCodingAgent,
  ServerPayload,
  ChargerPayload,
  PowerBankPayload,
  ActivityPayload,
} from "@/lib/types";

const fetchCharger = incrementalFetcher<ChargerPayload>(
  historyCursor,
  mergeChargerHistory,
);
const compact = (value: number | undefined | null) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);
const fixed = (value: number | null | undefined, digits = 1) =>
  value == null ? "—" : value.toFixed(digits);
const money = (value: number | undefined) =>
  value == null
    ? "—"
    : "$" +
      new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
        value,
      );
const bytes = (value: number, base = 1000) => {
  const units =
    base === 1000 ? ["B", "KB", "MB", "GB"] : ["B", "KiB", "MiB", "GiB"];
  const i = Math.max(
    0,
    Math.min(3, Math.floor(Math.log(Math.max(value, 1)) / Math.log(base))),
  );
  return `${(value / base ** i).toFixed(1)} ${units[i]}`;
};
const chapters = [
  { id: "compute", label: "灵感协作", en: "COMPUTE" },
  { id: "network", label: "远方节点", en: "NETWORK" },
  { id: "charger", label: "桌面供电", en: "POWER" },
  { id: "battery", label: "移动能量", en: "BATTERY" },
  { id: "activity", label: "屏幕之外", en: "MOVEMENT" },
] as const;
type Chapter = (typeof chapters)[number]["id"];

function Readout({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="data-line">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}
function Meter({ value }: { value: number }) {
  return (
    <div className="data-meter">
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
function Poster({
  eyebrow,
  value,
  unit,
  title,
  children,
}: {
  eyebrow: string;
  value: ReactNode;
  unit: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="telemetry-poster">
      <span className="micro">{eyebrow}</span>
      <div className="telemetry-rule">
        <i />
        <span>LIVE OBSERVATION</span>
        <i />
      </div>
      <div className="telemetry-number">
        {value}
        <small>{unit}</small>
      </div>
      <h2>{title}</h2>
      {children}
      <span className="poster-cross" aria-hidden="true">
        +
      </span>
    </div>
  );
}
function AgentReading({
  agent,
  staleAfter,
  activityUnknown,
}: {
  agent: VibeCodingAgent;
  staleAfter: number;
  activityUnknown: boolean;
}) {
  const [expanded, setExpanded] = useState(agent.id === "codex");
  const mounted = useMountedAt();
  const [tick, setTick] = useState(0);
  const now = tick || mounted;
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const stale = useStale(agent.limitsAt, staleAfter);
  const today = agent.today;
  const cacheInput = today
    ? today.inputTokens + today.cacheReadTokens + today.cacheCreationTokens
    : 0;
  return (
    <div className="agent-reading">
      <button
        className="agent-heading"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span>
          <small>
            {agent.plan?.label ?? "CODING AGENT"}
            {!activityUnknown && agent.active ? " / ACTIVE" : ""}
          </small>
          <strong>{agent.id === "grok" ? "Grok Build" : agent.label}</strong>
        </span>
        <span>
          {compact(today?.totalTokens)}
          <ArrowRight size={22} />
        </span>
      </button>
      {expanded && (
        <div className="agent-body">
          <span className="micro">
            {agent.currentModel ?? agent.topModel ?? "MODEL UNAVAILABLE"}
          </span>
          <Readout
            label={today ? `${today.date} · TOKENS` : "每日用量"}
            value={compact(today?.totalTokens)}
          />
          {today && (
            <>
              <Readout
                label={
                  agent.usageStatus.costComplete
                    ? "API 等值费用"
                    : "API 等值费用（部分）"
                }
                value={money(today.apiEquivalentCostUSD)}
              />
              <Readout
                label="缓存命中率"
                value={
                  cacheInput
                    ? `${fixed((today.cacheReadTokens / cacheInput) * 100)}%`
                    : "—"
                }
              />
            </>
          )}
          {agent.limits.map((limit) => {
            const reset = Boolean(
              limit.resetsAt && now && limit.resetsAt * 1000 <= now,
            );
            const percent = reset ? 0 : limit.usedPercent;
            const minutes = limit.windowMinutes;
            const name =
              limit.label ??
              (minutes
                ? minutes >= 1440
                  ? `${Math.round(minutes / 1440)} 天窗口`
                  : `${minutes / 60} 小时窗口`
                : "套餐窗口");
            const remaining =
              limit.resetsAt && now
                ? Math.max(0, Math.ceil((limit.resetsAt * 1000 - now) / 60000))
                : null;
            return (
              <div className="limit-reading" key={limit.key}>
                <div>
                  <span>
                    {name}
                    {stale ? " · 上次记录" : ""}
                  </span>
                  <strong>{fixed(percent, 0)}%</strong>
                </div>
                <Meter value={percent} />
                <small>
                  {reset
                    ? "本轮已重置"
                    : remaining != null
                      ? `${remaining >= 60 ? Math.floor(remaining / 60) + "h " : ""}${remaining % 60}m 后重置`
                      : "重置时间未知"}
                </small>
              </div>
            );
          })}
          {agent.limitsError && <p className="data-note">限额暂不可用</p>}
        </div>
      )}
    </div>
  );
}

export function SignalTelemetry({
  vibeCoding,
  server,
  charger,
  powerBank,
  activity,
}: {
  vibeCoding: StatusResponse<VibeCodingPayload>;
  server: StatusResponse<ServerPayload>;
  charger: StatusResponse<ChargerPayload>;
  powerBank: StatusResponse<PowerBankPayload>;
  activity: StatusResponse<ActivityPayload>;
}) {
  const [chapter, setChapter] = useState<Chapter>("compute");
  const { data: vibe } = useStatus<VibeCodingPayload>(
    VIBECODING_PATH,
    120_000,
    {
      fallback: vibeCoding,
      fetcher: fetchVibeCoding,
      seedFallback: seedVibeCoding,
    },
  );
  const { data: node } = useStatus<ServerPayload>(SERVER_PATH, 30_000, {
    fallback: server,
  });
  const local = useLocalCharging();
  const { data: remoteCharger } = useStatus<ChargerPayload>(
    CHARGER_PATH,
    local.charger ? 0 : 30_000,
    {
      fallback: charger,
      fetcher: fetchCharger,
      seedFallback: seedChargerHistory,
      revalidateOnFocus: !local.charger,
    },
  );
  const { data: remoteBank } = useStatus<PowerBankPayload>(
    POWERBANK_PATH,
    local.powerBank ? 0 : 30_000,
    { fallback: powerBank, revalidateOnFocus: !local.powerBank },
  );
  const charge = local.charger ?? remoteCharger;
  const bank = local.powerBank ?? remoteBank;
  const { data: move } = useStatus<ActivityPayload>(ACTIVITY_PATH, 300_000, {
    fallback: activity,
  });
  const reporter = useReporterStale(vibe);
  const collectorStale = useStale(vibe?.pushedAt, VIBECODING_STALE_MS);
  const nodeStale = useStale(
    node?.pushedAt,
    node?.staleAfterMs ?? SERVER_STALE_MS,
  );
  const chapterIndex = chapters.findIndex((item) => item.id === chapter);
  const totals = vibe?.totals;
  const currentMove = Boolean(move?.currentAtSource);
  const movement = move
    ? [
        {
          name: "活动",
          value: currentMove ? move.moveKcal : 0,
          goal: move.moveGoalKcal,
          unit: "kcal",
        },
        {
          name: "锻炼",
          value: currentMove ? move.exerciseMinutes : 0,
          goal: move.exerciseGoalMinutes,
          unit: "min",
        },
        {
          name: "站立",
          value: currentMove ? move.standHours : 0,
          goal: move.standGoalHours,
          unit: "hr",
        },
      ]
    : [];
  const curve = powerTrace(charge?.history ?? []);
  return (
    <div className="telemetry-exhibit" data-scroll>
      <div className="telemetry-tabs" role="group" aria-label="选择数据来源">
        {chapters.map((item, i) => (
          <button
            key={item.id}
            aria-pressed={chapter === item.id}
            onClick={() => setChapter(item.id)}
          >
            <span>0{i + 1}</span>
            {item.label}
            <small>{item.en}</small>
          </button>
        ))}
      </div>
      <div
        className={`telemetry-composition transmission-${chapter}`}
        key={chapter}
      >
        <span className="telemetry-ghost" aria-hidden="true">
          {chapters[chapterIndex].en}
        </span>
        {chapter === "compute" && (
          <>
            <Poster
              eyebrow="HUMAN × MACHINE / ALL TIME"
              value={compact(totals?.totalTokens)}
              unit="TOKENS"
              title="想法，正在发生。"
            >
              <div className="poster-facts">
                <span>
                  {compact(totals?.activeDays)}
                  <small>ACTIVE DAYS</small>
                </span>
                <span>
                  {compact(totals?.sessionCount)}
                  <small>SESSIONS</small>
                </span>
              </div>
              <p className="poster-footnote">
                {totals?.costComplete
                  ? "API 等值费用"
                  : "API 等值费用 · 已知价格部分"}
                　{money(totals?.apiEquivalentCostUSD)}
              </p>
            </Poster>
            <div className="telemetry-readings" data-scroll>
              <div className="readings-title">
                <span>CODING AGENTS</span>
                <span>来源 / 用量 / 限额</span>
              </div>
              {vibe?.agents
                .filter((agent) => !["opencode", "pi"].includes(agent.id))
                .map((agent) => (
                  <AgentReading
                    key={agent.id}
                    agent={agent}
                    staleAfter={vibe.limitsStaleAfterMs}
                    activityUnknown={reporter.offline || collectorStale}
                  />
                ))}
              {totals && (
                <div className="token-breakdown">
                  <Readout label="INPUT" value={compact(totals.inputTokens)} />
                  <Readout
                    label="OUTPUT"
                    value={compact(totals.outputTokens)}
                  />
                  <Readout
                    label="CACHE READ"
                    value={compact(totals.cacheReadTokens)}
                  />
                  <Readout
                    label="CACHE WRITE"
                    value={compact(totals.cacheCreationTokens)}
                  />
                  {vibe?.topModels.map((model, i) => (
                    <Readout
                      key={model.model}
                      label={`0${i + 1} / ${model.model}`}
                      value={compact(model.tokens)}
                    />
                  ))}
                </div>
              )}
              {!vibe && <p className="data-note">等待用量数据。</p>}
            </div>
          </>
        )}
        {chapter === "network" && (
          <>
            <Poster
              eyebrow={
                node
                  ? `${node.city ?? ""} / ${node.country ?? ""}`
                  : "REMOTE NODE"
              }
              value={node ? fixed(node.networkRxBytesPerSec / 1e6) : "—"}
              unit="MB / S"
              title={node?.hostname ?? "等待远方的回应"}
            >
              <div className="poster-network">
                <ArrowDownRight size={48} />
                <span>DOWNLOAD</span>
                <ArrowUpRight size={24} />
                <span>
                  {node ? bytes(node.networkTxBytesPerSec) + " / S" : "—"}
                </span>
              </div>
              <p className="poster-footnote">
                {node
                  ? node.staleAtSource || nodeStale
                    ? "连接中断 · 上次记录"
                    : "节点在线"
                  : "暂无节点数据"}
              </p>
            </Poster>
            <div className="telemetry-readings" data-scroll>
              <div className="readings-title">
                <span>NODE STATUS</span>
                <span>网络遥测</span>
              </div>
              {node && (
                <>
                  <Readout
                    label="NETWORK"
                    value={node.asnOrg ?? node.isp ?? "—"}
                  />
                  <Readout
                    label="UPTIME"
                    value={`${Math.floor(node.uptimeSeconds / 86400)}d ${Math.floor((node.uptimeSeconds % 86400) / 3600)}h`}
                  />
                  <Readout
                    label="CPU"
                    value={`${fixed(node.cpuUsagePercent)}%`}
                    detail={`${node.cpuCores} CORES`}
                  />
                  <Meter value={node.cpuUsagePercent} />
                  <Readout
                    label="MEMORY"
                    value={`${bytes(node.memoryUsedBytes, 1024)} / ${bytes(node.memoryTotalBytes, 1024)}`}
                  />
                  <Meter
                    value={(node.memoryUsedBytes / node.memoryTotalBytes) * 100}
                  />
                  <Readout label="OS" value={node.os} />
                  <Readout
                    label="LOAD"
                    value={`${fixed(node.load1, 2)} / ${fixed(node.load5, 2)} / ${fixed(node.load15, 2)}`}
                  />
                </>
              )}
            </div>
          </>
        )}
        {chapter === "charger" && (
          <>
            <Poster
              eyebrow={`ANKER / ${charge?.device.model ?? "CHARGER"}`}
              value={charge?.connected ? fixed(charge.totalPower) : "—"}
              unit="WATTS"
              title="流动的能量。"
            >
              <svg
                className="power-trace"
                viewBox="0 0 480 110"
                role="img"
                aria-label="充电功率历史"
              >
                <path
                  d="M0 100H480M0 50H480"
                  stroke="currentColor"
                  opacity=".12"
                />
                <polyline
                  points={curve}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
              <p className="poster-footnote">
                {charge?.connected
                  ? `${charge.totalPower > 1 ? "正在供电" : "待机"} / MAX ${charge.maxPower} W`
                  : "设备未连接"}
              </p>
            </Poster>
            <div className="telemetry-readings" data-scroll>
              <div className="readings-title">
                <span>PORT ALLOCATION</span>
                <span>端口分配</span>
              </div>
              {charge?.ports.map((port) => (
                <div className="port-reading" key={port.id}>
                  <span className="port-number">{port.id}</span>
                  <div>
                    <strong>
                      {charge.connected && port.active
                        ? fixed(port.power) + " W"
                        : "—"}
                    </strong>
                    <p>
                      {charge.connected && port.active
                        ? (port.device ?? "已连接设备")
                        : "空闲"}
                    </p>
                    <small>
                      {charge.connected && port.active
                        ? `${fixed(port.voltage)} V / ${fixed(port.current, 2)} A`
                        : "NO POWER FLOW"}
                    </small>
                  </div>
                </div>
              ))}
              <Readout
                label="FIRMWARE"
                value={charge?.device.firmwareVersion ?? "—"}
              />
            </div>
          </>
        )}
        {chapter === "battery" && (
          <>
            <Poster
              eyebrow={`ANKER / ${bank?.device.model ?? "POWER BANK"}`}
              value={bank?.connected ? fixed(bank.battery) : "—"}
              unit="PERCENT"
              title="随时，再次出发。"
            >
              <div className="battery-spectrum" aria-hidden="true">
                {Array.from({ length: 40 }, (_, i) => (
                  <i
                    key={i}
                    className={
                      bank?.connected && i < (bank.battery ?? 0) / 2.5
                        ? "filled"
                        : ""
                    }
                  />
                ))}
              </div>
              <p className="poster-footnote">
                {!bank?.connected
                  ? "设备未连接"
                  : bank.thermalLimited
                    ? "温度限制"
                    : bank.charging
                      ? bank.outputPower > 1
                        ? "边充边放"
                        : "充电中"
                      : bank.outputPower > 1
                        ? "供电中"
                        : "待机"}
              </p>
            </Poster>
            <div className="telemetry-readings" data-scroll>
              <div className="readings-title">
                <span>ENERGY STATUS</span>
                <span>能量状态</span>
              </div>
              <Readout
                label="INPUT / OUTPUT"
                value={
                  bank?.connected
                    ? `${fixed(bank.inputPower)} W / ${fixed(bank.outputPower)} W`
                    : "—"
                }
              />
              <Readout
                label="充满还需"
                value={
                  bank?.connected &&
                  bank.charging &&
                  bank.timeToFullMinutes != null
                    ? `${bank.timeToFullMinutes} min`
                    : "—"
                }
              />
              <Readout
                label="TEMPERATURE"
                value={
                  bank?.connected && bank.temperatures.length
                    ? bank.temperatures.join(" / ") + " °C"
                    : "—"
                }
              />
              <Readout
                label="BATTERY HEALTH"
                value={
                  bank?.batteryHealth != null ? bank.batteryHealth + "%" : "—"
                }
              />
              {bank?.ports.map((port) => (
                <Readout
                  key={port.id}
                  label={port.id}
                  value={
                    bank.connected && port.active
                      ? `${port.direction === "in" ? "↓" : "↑"} ${fixed(port.power)} W`
                      : bank.connected && port.attached
                        ? "已连接 / 无功率"
                        : "空闲"
                  }
                  detail={
                    bank.connected && port.active
                      ? `${fixed(port.voltage)} V · ${fixed(port.current, 2)} A`
                      : undefined
                  }
                />
              ))}
            </div>
          </>
        )}
        {chapter === "activity" && (
          <>
            <Poster
              eyebrow={`APPLE WATCH / ${move?.date ?? "WAITING"}`}
              value={move ? compact(currentMove ? move.steps : 0) : "—"}
              unit="STEPS"
              title="屏幕之外的生活。"
            >
              <div className="movement-traces">
                {movement.map((item) => (
                  <div key={item.name}>
                    <span>{item.name}</span>
                    <Meter
                      value={item.goal ? (item.value / item.goal) * 100 : 0}
                    />
                    <b>
                      {item.goal
                        ? Math.round((item.value / item.goal) * 100)
                        : 0}
                      %
                    </b>
                  </div>
                ))}
              </div>
            </Poster>
            <div className="telemetry-readings" data-scroll>
              <div className="readings-title">
                <span>DAILY MOVEMENT</span>
                <span>
                  {move?.currentAtSource ? "当日记录" : "等待当日记录"}
                </span>
              </div>
              {movement.map((item) => (
                <Readout
                  key={item.name}
                  label={item.name}
                  value={`${item.value} / ${item.goal}`}
                  detail={item.unit}
                />
              ))}
              <Readout
                label="步行与跑步"
                value={
                  move?.distanceMeters != null
                    ? `${fixed(currentMove ? move.distanceMeters / 1000 : 0, 2)} km`
                    : "—"
                }
              />
              <Readout
                label="爬楼层数"
                value={
                  move?.flightsClimbed != null
                    ? currentMove
                      ? move.flightsClimbed
                      : 0
                    : "—"
                }
              />
            </div>
          </>
        )}
      </div>
      <div className="transmission-caption">
        <span>TRANSMISSION 0{chapterIndex + 1}</span>
        <span>THINGS QUIETLY IN MOTION</span>
      </div>
    </div>
  );
}

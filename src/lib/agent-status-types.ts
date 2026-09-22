/**
 * 厂商状态卡的公开形状。浏览器和 Worker 都用，所以这里只有类型和文案，
 * 不发请求、不碰缓存。
 */

export type AgentIndicator =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage"
  | "maintenance"
  | "unavailable"
  | "unmonitored";

export type AgentIncident = {
  id: string;
  title: string;
  /** 给人看的状态，如 Investigating、Resolved */
  status: string;
  url: string;
  /** ISO 8601，没有就 null */
  updatedAt: string | null;
  body: string;
};

export type AgentStatusComponent = {
  name: string;
  indicator: AgentIndicator;
};

export type AgentStatusRow = {
  id: "claude" | "codex" | "cursor" | "grok" | "antigravity";
  name: string;
  indicator: AgentIndicator;
  statusUrl: string;
  components: AgentStatusComponent[];
  incidents: AgentIncident[];
  /** 没有官方状态页、或这一轮结构对不上时的说明。正常时是 null */
  note: string | null;
  /** 这一轮请求失败，灯和事件还是上一轮的 */
  stale: boolean;
};

export type AgentStatusPayload = {
  /** 这一轮检查结束的时刻，毫秒 */
  fetchedAt: number;
  agents: AgentStatusRow[];
};

/** 行尾那几个词。和状态页自己的叫法对齐：degraded performance 收成 Degraded。 */
export function indicatorLabel(indicator: AgentIndicator): string {
  switch (indicator) {
    case "operational":
      return "Operational";
    case "degraded":
      return "Degraded";
    case "partial_outage":
      return "Partial outage";
    case "major_outage":
      return "Outage";
    case "maintenance":
      return "Maintenance";
    case "unavailable":
      return "Unavailable";
    case "unmonitored":
      return "No status page";
  }
}

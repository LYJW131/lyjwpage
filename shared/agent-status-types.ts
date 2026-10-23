
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
  status: string;
  url: string;
  updatedAt: string | null;
  body: string;
};

export type AgentStatusComponent = {
  name: string;
  indicator: AgentIndicator;
};

export type AgentStatusRow = {
  id:
    | "claude"
    | "codex"
    | "cursor"
    | "grok"
    | "typesafe"
    | "devin"
    | "apple"
    | "github"
    | "cloudflare";
  name: string;
  indicator: AgentIndicator;
  statusUrl: string;
  components: AgentStatusComponent[];
  incidents: AgentIncident[];
  note: string | null;
  stale: boolean;
  // indicator 为 major_outage 时才有：epoch 毫秒，沿用上一轮；首次看到才取活跃故障的开始时间，再没有就取采集时刻。
  outageSince?: number;
};

export type AgentStatusPayload = {
  fetchedAt: number;
  agents: AgentStatusRow[];
};

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

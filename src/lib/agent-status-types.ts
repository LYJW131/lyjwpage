
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
    | "apple"
    | "vercel"
    | "github"
    | "cloudflare";
  name: string;
  indicator: AgentIndicator;
  statusUrl: string;
  components: AgentStatusComponent[];
  incidents: AgentIncident[];
  note: string | null;
  stale: boolean;
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

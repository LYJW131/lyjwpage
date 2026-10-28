import { object, text } from "@shared/json";

import type { AgentIncident, AgentIndicator, AgentStatusRow } from "@shared/agent-status-types";
import { MAX_INCIDENTS, clip, displayStatus, iso, list, worst, type StatuspageComponent } from "./agent-status-format";

type StatuspageIncident = {
  id: string;
  name: string;
  status: string;
  impact: string | null;
  url: string;
  updatedAt: string | null;
  startedAt: string | null;
  body: string;
  componentNames: string[];
};

function componentIndicator(status: string): AgentIndicator | null {
  switch (status) {
    case "operational":
      return "operational";
    case "degraded_performance":
      return "degraded";
    case "partial_outage":
      return "partial_outage";
    case "major_outage":
      return "major_outage";
    case "under_maintenance":
      return "maintenance";
    default:
      return null;
  }
}

function rollupIndicator(value: string | null): AgentIndicator | null {
  switch (value) {
    case "none":
      return "operational";
    case "minor":
      return "degraded";
    case "major":
      return "partial_outage";
    case "critical":
      return "major_outage";
    case "maintenance":
      return "maintenance";
    default:
      return null;
  }
}

export function isClaudeComponent(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized === "claude code" || normalized.startsWith("claude api");
}

export function isCodexComponent(name: string): boolean {
  switch (name.trim().toLowerCase()) {
    case "codex web":
    case "codex in chatgpt desktop":
    case "codex api":
    case "cli":
    case "vs code extension":
      return true;
    default:
      return false;
  }
}

export function isDevinComponent(name: string): boolean {
  return !/\b(enterprise|fedstart)\b/i.test(name);
}

export const CLOUDFLARE_SITE_COMPONENTS: Record<string, true> = {
  api: true,
  "authoritative dns": true,
  d1: true,
  "dns updates": true,
  "durable objects": true,
  r2: true,
  websockets: true,
  workers: true,
  "workers builds": true,
  "workers kv": true,
};

function parseStatuspage(body: string, pageUrl: string): {
  page: AgentIndicator | null;
  components: StatuspageComponent[];
  incidents: StatuspageIncident[];
  maintenances: StatuspageIncident[];
} {
  const root = object(JSON.parse(body));
  if (!root) throw new Error("status page JSON is not an object");
  const page = rollupIndicator(text(object(root.status)?.indicator));
  const components: StatuspageComponent[] = [];
  for (const item of list(root.components)) {
    const record = object(item);
    const name = text(record?.name);
    const indicator = componentIndicator(text(record?.status) ?? "");
    if (name && indicator) components.push({ name, indicator });
  }
  const incident = (item: unknown): StatuspageIncident | null => {
    const record = object(item);
    const name = text(record?.name);
    const id = text(record?.id);
    if (!record || !name || !id) return null;
    const updates = list(record.incident_updates)
      .map((update) => {
        const row = object(update);
        const created = text(row?.created_at) ?? text(row?.display_at);
        return {
          at: created ? Date.parse(created) : Number.NaN,
          body: text(row?.body) ?? "",
          status: text(row?.status),
        };
      })
      .filter((update) => update.body);
    updates.sort((left, right) => (right.at || 0) - (left.at || 0));
    const latest = updates[0];
    const componentNames = list(record.components)
      .map((component) => text(object(component)?.name))
      .filter((component): component is string => !!component);
    return {
      id,
      name,
      status: text(record.status) ?? latest?.status ?? "update",
      impact: text(record.impact),
      url: text(record.shortlink) ?? `${pageUrl}/incidents/${id}`,
      updatedAt: iso(text(record.updated_at) ?? (Number.isFinite(latest?.at) ? new Date(latest.at).toISOString() : null)),
      startedAt: iso(text(record.started_at) ?? text(record.created_at)),
      body: clip(latest?.body ?? ""),
      componentNames,
    };
  };
  return {
    page,
    components,
    incidents: list(root.incidents).map(incident).filter((item): item is StatuspageIncident => !!item),
    maintenances: list(root.scheduled_maintenances).map(incident).filter((item): item is StatuspageIncident => !!item),
  };
}

function toPublicIncident(incident: StatuspageIncident): AgentIncident {
  return {
    id: incident.id,
    title: incident.name,
    status: displayStatus(incident.status),
    url: incident.url,
    updatedAt: incident.updatedAt,
    body: incident.body,
  };
}

function closedStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized === "resolved" || normalized === "completed" || normalized === "scheduled";
}

export function statuspageRow(
  id: AgentStatusRow["id"],
  name: string,
  pageUrl: string,
  body: string,
  include: (component: string) => boolean,
  wholePage: boolean,
): AgentStatusRow {
  const parsed = parseStatuspage(body, pageUrl);
  const selected = parsed.components.filter((component) => include(component.name));
  const names = new Set(selected.map((component) => component.name));
  const touches = (incident: StatuspageIncident) =>
    wholePage || incident.componentNames.some((component) => names.has(component));
  const active = [...parsed.incidents, ...parsed.maintenances].filter(
    (incident) => touches(incident) && !closedStatus(incident.status),
  );
  const scheduled = parsed.maintenances.filter(
    (incident) => touches(incident) && incident.status.toLowerCase() === "scheduled",
  );
  // 页面总灯优先于单个组件和单个事件的 impact；否则常驻的组件故障或事件自标的 major 会把整行误判得比状态页本身更严重。
  const followPage = wholePage && !!parsed.page;
  const incidentIndicators: AgentIndicator[] = [];
  for (const incident of active) {
    const impact = followPage ? null : rollupIndicator(incident.impact);
    if (impact) incidentIndicators.push(impact);
    if (incident.status.toLowerCase() === "in_progress" || incident.status.toLowerCase() === "verifying") {
      incidentIndicators.push("maintenance");
    }
  }
  const componentIndicators = selected.map((component) => component.indicator);
  const indicators =
    wholePage && parsed.page
      ? [parsed.page, ...incidentIndicators]
      : [...componentIndicators, ...incidentIndicators];
  const missing = selected.length === 0 && !wholePage;
  const indicator = missing ? "unavailable" : worst(indicators);
  const started = active
    .filter((incident) => incident.impact === "critical" || incident.impact === "major")
    .map((incident) => (incident.startedAt ? Date.parse(incident.startedAt) : Number.NaN))
    .filter(Number.isFinite);
  return {
    id,
    name,
    indicator,
    ...(indicator === "major_outage" && started.length ? { outageSince: Math.min(...started) } : {}),
    statusUrl: pageUrl,
    components: selected.map((component) => ({ name: component.name, indicator: component.indicator })),
    incidents: [...active, ...scheduled].slice(0, MAX_INCIDENTS).map(toPublicIncident),
    note: missing ? "The status page no longer lists the components this row watches." : null,
    stale: false,
  };
}

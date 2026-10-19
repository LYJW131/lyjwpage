import { object, text } from "@shared/json";

import type { AgentIncident, AgentIndicator, AgentStatusRow } from "@shared/agent-status-types";
import { MAX_INCIDENTS, STATUS_PAGES, clip, displayStatus, iso, list, worst, type StatuspageComponent } from "./agent-status-format";

function betterStackIndicator(state: string | null): AgentIndicator | null {
  switch (state) {
    case "operational":
      return "operational";
    case "degraded":
      return "degraded";
    case "downtime":
      return "major_outage";
    case "maintenance":
      return "maintenance";
    default:
      return null;
  }
}

// Better Stack 的 ends_at 可能始终为空；结束状态以 aggregate_state 为准。
export function typesafeRow(body: string, now: number): AgentStatusRow {
  const root = object(JSON.parse(body));
  const page = object(object(root?.data)?.attributes);
  if (!page) throw new Error("status.typesafe.ai index.json has no page attributes");
  const included = list(root?.included).map(object).filter((item): item is Record<string, unknown> => !!item);
  const ofType = (type: string) => included.filter((item) => item.type === type);

  const components: StatuspageComponent[] = [];
  for (const resource of ofType("status_page_resource")) {
    const attributes = object(resource.attributes);
    const name = text(attributes?.public_name);
    const indicator = betterStackIndicator(text(attributes?.status));
    if (name && indicator) components.push({ name, indicator });
  }

  const updates = new Map<string, { at: number; message: string }>();
  for (const update of ofType("status_update")) {
    const id = text(update.id);
    const attributes = object(update.attributes);
    const published = text(attributes?.published_at);
    if (id) updates.set(id, { at: published ? Date.parse(published) : Number.NaN, message: text(attributes?.message) ?? "" });
  }

  const active: { incident: AgentIncident; indicator: AgentIndicator | null }[] = [];
  const scheduled: AgentIncident[] = [];
  for (const report of ofType("status_report")) {
    const id = text(report.id);
    const attributes = object(report.attributes);
    const title = text(attributes?.title);
    const state = text(attributes?.aggregate_state) ?? "";
    if (!id || !title || state === "resolved") continue;
    const latest = list(object(object(report.relationships)?.status_updates)?.data)
      .map((ref) => updates.get(text(object(ref)?.id) ?? ""))
      .filter((update): update is { at: number; message: string } => !!update)
      .sort((left, right) => (right.at || 0) - (left.at || 0))[0];
    const startsAt = Date.parse(text(attributes?.starts_at) ?? "");
    const upcoming = Number.isFinite(startsAt) && startsAt > now;
    const incident: AgentIncident = {
      id,
      title,
      status: upcoming ? "Scheduled" : displayStatus(state),
      url: `${STATUS_PAGES.typesafe}/incident/${id}`,
      updatedAt: latest && Number.isFinite(latest.at) ? new Date(latest.at).toISOString() : iso(text(attributes?.starts_at)),
      body: clip(latest?.message ?? ""),
    };
    if (upcoming) scheduled.push(incident);
    else active.push({ incident, indicator: betterStackIndicator(state) });
  }

  const pageIndicator = betterStackIndicator(text(page.aggregate_state));
  const indicators = [
    ...(pageIndicator ? [pageIndicator] : components.map((component) => component.indicator)),
    ...active.map((item) => item.indicator ?? "degraded"),
  ];
  return {
    id: "typesafe",
    name: "TypeSafe",
    indicator: worst(indicators),
    statusUrl: STATUS_PAGES.typesafe,
    components,
    incidents: [...active.map((item) => item.incident), ...scheduled].slice(0, MAX_INCIDENTS),
    note: null,
    stale: false,
  };
}

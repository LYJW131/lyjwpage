import { object, text } from "@shared/json";

import type { AgentIncident, AgentIndicator, AgentStatusRow } from "@shared/agent-status-types";
import { MAX_INCIDENTS, STATUS_PAGES, clip, displayStatus, iso, list, worst } from "./agent-status-format";

type AppleEvent = {
  service: string;
  url: string;
  statusType: string;
  eventStatus: string;
  startDate: string | null;
  endDate: string | null;
  usersAffected: string;
  message: string;
};

const APPLE_WATCHED_SERVICES: Record<string, true> = {
  "apple music api": true,
  "certificates, identifiers & profiles": true,
  "developer id notary service": true,
  "provisioning profile service": true,
  "xcode automatic configuration": true,
};

export function parseAppleStatus(body: string): { services: string[]; events: AppleEvent[] } {
  const open = body.indexOf("{");
  const close = body.lastIndexOf("}");
  if (open < 0 || close < open) throw new Error("Apple system status is not JSONP");
  const services = object(JSON.parse(body.slice(open, close + 1)))?.services;
  if (!Array.isArray(services)) throw new Error("Apple system status has no services");
  const names: string[] = [];
  const events: AppleEvent[] = [];
  for (const item of services) {
    const service = object(item);
    const name = text(service?.serviceName);
    if (!service || !name) continue;
    names.push(name);
    for (const entry of list(service.events)) {
      const event = object(entry);
      if (!event) continue;
      events.push({
        service: name,
        url: text(service.redirectUrl) ?? STATUS_PAGES.apple,
        statusType: (text(event.statusType) ?? "").toLowerCase(),
        eventStatus: (text(event.eventStatus) ?? "").toLowerCase(),
        startDate: text(event.startDate),
        endDate: text(event.endDate),
        usersAffected: text(event.usersAffected) ?? "",
        message: text(event.message) ?? "",
      });
    }
  }
  return { services: names, events };
}

function appleSeverity(event: AppleEvent): Exclude<AgentIndicator, "unavailable" | "unmonitored"> {
  if (event.statusType === "maintenance") return "maintenance";
  if (event.statusType === "outage") return /\ball users\b/i.test(event.usersAffected) ? "major_outage" : "partial_outage";
  return "degraded";
}

export function appleRow(body: string): AgentStatusRow {
  const parsed = parseAppleStatus(body);
  const watched = (name: string) => name.toLowerCase() in APPLE_WATCHED_SERVICES;
  const services = parsed.services.filter(watched);
  const events = parsed.events.filter((event) => watched(event.service));
  const closed = (event: AppleEvent) => event.eventStatus === "resolved" || event.eventStatus === "completed";
  const upcoming = (event: AppleEvent) => event.eventStatus === "upcoming" || event.eventStatus === "scheduled";
  const active = events.filter((event) => !closed(event) && !upcoming(event));
  const scheduled = events.filter(upcoming);
  const incident = (event: AppleEvent): AgentIncident => ({
    id: `${event.service}|${event.startDate ?? ""}`,
    title: event.service,
    status: upcoming(event) ? "Scheduled" : displayStatus(event.eventStatus || "ongoing"),
    url: event.url,
    updatedAt: iso(event.startDate),
    body: clip(
      [event.message, event.usersAffected]
        .map((part) => part.replace(/\.\s*$/, ""))
        .filter(Boolean)
        .map((part) => `${part}.`)
        .join(" "),
    ),
  });
  const serviceIndicator = (name: string): AgentIndicator => {
    const own = active.filter((event) => event.service === name);
    return own.length ? worst(own.map(appleSeverity)) : "operational";
  };
  const missing = services.length === 0;
  return {
    id: "apple",
    name: "Apple",
    indicator: missing ? "unavailable" : worst(services.map(serviceIndicator)),
    statusUrl: STATUS_PAGES.apple,
    components: services.map((name) => ({ name, indicator: serviceIndicator(name) })),
    incidents: [...active, ...scheduled].slice(0, MAX_INCIDENTS).map(incident),
    note: missing ? "The status page no longer lists the services this row watches." : null,
    stale: false,
  };
}

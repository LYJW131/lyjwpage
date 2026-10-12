import type { BrowserOptions, Event } from "@sentry/react";

type StreamedSpan = Parameters<NonNullable<BrowserOptions["beforeSendSpan"]>>[0];

const SPAN_URL_KEYS = ["http.url", "url.full", "url"] as const;
const BREADCRUMB_URL_KEYS = ["url", "from", "to"] as const;
const SPAN_METHOD_URL = /^([A-Z]+) (https?:\/\/\S+)$/;

function stripUrlQuery(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    const cut = [url.indexOf("?"), url.indexOf("#")].filter((index) => index >= 0);
    return cut.length ? url.slice(0, Math.min(...cut)) : url;
  }
}

function looksLikePathOrUrl(value: string): boolean {
  return value.startsWith("/") || /^https?:\/\//.test(value);
}

export function redactSentryEvent<T extends Event>(event: T): T {
  if (typeof event.request?.url === "string") {
    event.request = { ...event.request, url: stripUrlQuery(event.request.url) };
  }
  if (Array.isArray(event.breadcrumbs)) {
    for (const crumb of event.breadcrumbs) {
      if (!crumb?.data) continue;
      for (const key of BREADCRUMB_URL_KEYS) {
        const value: unknown = crumb.data[key];
        if (typeof value === "string" && looksLikePathOrUrl(value)) {
          crumb.data = { ...crumb.data, [key]: stripUrlQuery(value) };
        }
      }
    }
  }
  if (Array.isArray(event.spans)) {
    for (const span of event.spans) {
      const data = span?.data;
      if (data) {
        for (const key of SPAN_URL_KEYS) {
          if (typeof data[key] === "string") data[key] = stripUrlQuery(data[key]);
        }
      }
      const match = typeof span?.description === "string" ? SPAN_METHOD_URL.exec(span.description) : null;
      if (match) span.description = `${match[1]} ${stripUrlQuery(match[2])}`;
    }
  }
  return event;
}

export function redactSentrySpan(span: StreamedSpan): StreamedSpan {
  for (const key of SPAN_URL_KEYS) {
    const value = span.attributes[key];
    if (typeof value === "string") span.attributes[key] = stripUrlQuery(value);
  }
  delete span.attributes["url.query"];
  delete span.attributes["url.fragment"];
  const match = SPAN_METHOD_URL.exec(span.name);
  if (match) span.name = `${match[1]} ${stripUrlQuery(match[2])}`;
  return span;
}

// 浏览器与 site Worker 共用。dataCollection 没写的项按全开补齐（IP、请求头、正文、查询串），所以每项都显式写。
export const SENTRY_SITE_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
} satisfies NonNullable<BrowserOptions["dataCollection"]>;

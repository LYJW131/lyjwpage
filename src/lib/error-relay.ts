import { BodyTooLargeError, readBoundedBytes } from "@shared/read-bounded-bytes";
import { SITE_ANALYTICS_HOSTS } from "@shared/site-analytics";

export const ERROR_RELAY_PATH = "/relay";
export const ERROR_RELAY_MAX_BYTES = 16_384;

const LIMITS = { name: 120, message: 1_000, stack: 8_000, url: 500, tagKey: 40, tagValue: 120, tags: 8 } as const;

export const CLIENT_ERROR_SOURCES = ["window", "rejection", "route", "boundary", "hydration"] as const;
export type ClientErrorSource = (typeof CLIENT_ERROR_SOURCES)[number];

// 浏览器 → site Worker 的上报正文；url 不带查询串与片段，访客输入可能出现在查询串里。
export type ClientErrorReport = {
  source: ClientErrorSource;
  name: string;
  message: string;
  stack: string | null;
  url: string;
  release: string | null;
  tags: Record<string, string>;
};

export function stripUrlQuery(url: string): string {
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

// 消息与调用栈里的 URL 同样去掉查询串、片段与账号密码，留下栈帧末尾的 :行:列。
const URL_IN_TEXT = /\b(https?:\/\/)(?:[^\s/@"'()<>]*@)?([^\s?#"'()<>]+?)(?:[?#][^\s"'()<>]*?)?(?=(?::\d+){1,2}(?=[\s"'()<>]|$)|[\s"'()<>]|$)/g;

function stripUrlsInText(value: string): string {
  return value.replace(URL_IN_TEXT, "$1$2");
}

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() ? value.slice(0, max) : null;

export function parseClientErrorReport(raw: unknown): ClientErrorReport | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const source = CLIENT_ERROR_SOURCES.find((value) => value === body.source);
  const message = text(body.message, LIMITS.message);
  const url = text(body.url, LIMITS.url);
  if (!source || !message || !url) return null;
  const stack = text(body.stack, LIMITS.stack);
  const tags: Record<string, string> = {};
  if (body.tags && typeof body.tags === "object" && !Array.isArray(body.tags)) {
    for (const [key, value] of Object.entries(body.tags).slice(0, LIMITS.tags)) {
      const tag = text(value, LIMITS.tagValue);
      if (tag && /^[\w.-]+$/.test(key)) tags[key.slice(0, LIMITS.tagKey)] = tag;
    }
  }
  return {
    source,
    name: text(body.name, LIMITS.name) ?? "Error",
    message: stripUrlsInText(message),
    stack: stack && stripUrlsInText(stack),
    url: stripUrlQuery(url),
    release: text(body.release, 64),
    tags,
  };
}

// 交给 console.error 的是 Error 对象，Workers Observability 才会把浏览器端调用栈记成异常并按它归入 Issues。
export function reportAsError(report: ClientErrorReport): Error {
  const error = new Error(report.message);
  error.name = report.name;
  error.stack = report.stack ?? `${report.name}: ${report.message}`;
  return error;
}

// 别的网站能不经预检让访客的浏览器发 text/plain 的 POST，所以带 Origin 的只收本站：同主机（含分支预览与本地），或跨域直连 lyjw.me 上报的 lyjw131.com（见 error-report.ts#relayTarget）。
export function isSiteOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (origin === null) return true;
  try {
    const { host, protocol } = new URL(origin);
    return host === new URL(request.url).host || (protocol === "https:" && (SITE_ANALYTICS_HOSTS as readonly string[]).includes(host));
  } catch {
    return false;
  }
}

export async function relayClientError(
  request: Request,
  log: (...args: unknown[]) => void = console.error,
): Promise<number> {
  let body: Uint8Array<ArrayBuffer>;
  try {
    body = await readBoundedBytes(request.body, ERROR_RELAY_MAX_BYTES);
  } catch (error) {
    return error instanceof BodyTooLargeError ? 413 : 400;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return 400;
  }
  const report = parseClientErrorReport(raw);
  if (!report) return 400;
  log("[browser-error]", reportAsError(report), { source: report.source, url: report.url, release: report.release, tags: report.tags });
  return 204;
}

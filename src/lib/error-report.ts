import { commitSha } from "@/lib/build-info";
import { ERROR_RELAY_PATH, stripUrlQuery, type ClientErrorReport, type ClientErrorSource } from "@/lib/error-relay";

export const ERROR_REPORT_ENABLED =
  (process.env.DEPLOY_ENV || "development") !== "development" || process.env.PUBLIC_ERROR_REPORT_DEV === "true";

// 一页最多报这么多条、同一条只报一次：渲染循环里反复抛的同一个错不该刷满日志。
const MAX_REPORTS_PER_PAGE = 10;
const seen = new Set<string>();

export function clientErrorReport(error: unknown, source: ClientErrorSource, tags: Record<string, string> = {}): ClientErrorReport {
  const err = error instanceof Error ? error : null;
  return {
    source,
    name: err?.name || "Error",
    message: err?.message || (typeof error === "string" ? error : String(error)),
    stack: err?.stack ?? null,
    url: stripUrlQuery(window.location.href),
    release: commitSha,
    tags,
  };
}

export function reportError(error: unknown, source: ClientErrorSource, tags?: Record<string, string>): void {
  if (!ERROR_REPORT_ENABLED || typeof window === "undefined") return;
  const report = clientErrorReport(error, source, tags);
  const key = `${report.name}:${report.message}`;
  if (seen.has(key) || seen.size >= MAX_REPORTS_PER_PAGE) return;
  seen.add(key);
  const body = JSON.stringify(report);
  // 用 text/plain：sendBeacon 遇到非 CORS 安全的 Blob 类型，部分浏览器会直接抛错；中转按 JSON 解析，不看类型。
  if (navigator.sendBeacon?.(ERROR_RELAY_PATH, new Blob([body], { type: "text/plain" }))) return;
  fetch(ERROR_RELAY_PATH, { method: "POST", body, keepalive: true }).catch(() => {});
}

// 跨域脚本的错误被浏览器抹成 "Script error."，没有可查的内容；扩展注入的脚本也不归本站。
function fromThisSite(event: ErrorEvent): boolean {
  if (event.message === "Script error.") return false;
  return !event.filename || event.filename.startsWith(window.location.origin);
}

export function installGlobalErrorReporting(): void {
  if (!ERROR_REPORT_ENABLED) return;
  window.addEventListener("error", (event) => {
    if (fromThisSite(event)) reportError(event.error ?? event.message, "window");
  });
  window.addEventListener("unhandledrejection", (event) => reportError(event.reason, "rejection"));
}

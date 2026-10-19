type FailedRequest = { url: string; status: number | null; error?: string; sameOrigin: boolean };
export type Sink = { errors: string[]; warnings: string[]; pageErrors: string[]; envNoise: string[]; failedRequests: FailedRequest[] };

// 环境噪声不是站点错误（SKILL.md 约定）：容器代理把 WebSocket 升级挡成 426，消息里必须同时有 426 才豁免；
// Vite dev 重优化依赖时偶发 504。其它 ws 失败（鉴权、路由、5xx）照常算。
const ENV_NOISE = [
  /WebSocket connection to '\w+:\/\/[^']*\/ws[^']*' failed.*\b426\b/i,
  /Outdated Optimize Dep/,
];

export function isEnvNoise(text: string): boolean {
  return ENV_NOISE.some((pattern) => pattern.test(text));
}

// 归一化「这条控制台面干不干净」：cards 与 shot 同一份判据，envNoise 不算。
export function consoleClean(sink: Sink): boolean {
  return (
    sink.errors.length === 0 &&
    sink.pageErrors.length === 0 &&
    !sink.failedRequests.some((request) => request.sameOrigin)
  );
}

export function newSink(): Sink {
  return { errors: [], warnings: [], pageErrors: [], envNoise: [], failedRequests: [] };
}

// 返回 "noise" | "same-origin" | "external"。noise 只放确定的环境原因：/favicon.ico 是浏览器自动探测
// （站点图标在 /icon，生产同样 404）；WebSocket 升级只豁免容器代理回的 426，requestfailed 没有状态码、
// 其它 ws 失败（鉴权 4xx、路由、5xx、断网）一律按源分类，同源计入失败。
export function classifyRequest(url: string, status: number | null, origin: string | null): "noise" | "same-origin" | "external" {
  const parsed = new URL(url);
  if (parsed.pathname === "/favicon.ico") return "noise";
  const isWebSocket = parsed.protocol === "ws:" || parsed.protocol === "wss:";
  if ((isWebSocket || parsed.pathname === "/ws") && status === 426) return "noise";
  if (!origin) return "external";
  // ws(s): 的 origin 是 ws 方案、和 http(s) origin 比不等；同站 ws 按 host 相等判。
  const sameOrigin = isWebSocket ? parsed.host === new URL(origin).host : parsed.origin === origin;
  return sameOrigin ? "same-origin" : "external";
}

// 导航目的地的 origin；about:blank / data: / chrome-error: 这类没有有效 origin 的返回 null，由调用方决定保不保留旧值。
export function navOrigin(url: string): string | null {
  const origin = new URL(url).origin;
  return origin === "null" ? null : origin;
}

export function updateOrigin(current: { origin: string | null }, url: string): string | null {
  const origin = navOrigin(url);
  if (origin) current.origin = origin;
  return current.origin;
}

// 把 sink 的脏处点成一句话，写进失败输出的 next。
export function consoleProblems(sink: Sink): string {
  const bad: string[] = [];
  if (sink.errors.length) bad.push(`console.errors ${sink.errors.length} 条`);
  if (sink.pageErrors.length) bad.push(`pageErrors ${sink.pageErrors.length} 条`);
  const sameOrigin = sink.failedRequests.filter((r) => r.sameOrigin);
  if (sameOrigin.length) bad.push(`同源失败请求 ${sameOrigin.length} 条（如 ${sameOrigin[0]?.url}）`);
  return bad.join("；");
}

// Wrangler 多配置模式只有第一个 Worker 获得端口，其余本地入口必须通过绑定转发。

import { APPLE_MUSIC_HTTP_PATHS } from "../../../shared/apple-music-paths";

type Fetcher = { fetch(input: Request | string, init?: RequestInit): Promise<Response> };

interface Env {
  CORE: Fetcher;
  INGRESS: Fetcher;
  COLLECTOR: Fetcher;
  COLLECTOR_RPC: { refresh(jobs: string[]): Promise<unknown> };
}

const COLLECTOR_PREFIX = "/__dev/collector/";
const INGRESS_INTERNAL_PATHS = new Set(["/api/internal/site-deployed", "/api/internal/collector-refresh"]);

// 注入存在 core 里，采集 Worker 的路径（歌词等）不经 core，要在这里先问一次，SSR 与浏览器才都拿到注入。
// 查询参数从尾部逐个去掉再试：浏览器的歌词请求多带 `&format=`，场景只按 `?song=` 注入。
async function devOverride(env: Env, url: URL): Promise<Response | null> {
  const params = [...url.searchParams];
  for (let kept = params.length; kept >= 0; kept--) {
    const search = kept ? `?${new URLSearchParams(params.slice(0, kept))}` : "";
    const response = await env.CORE.fetch(`http://core/api/dev/override${url.pathname}${search}`);
    if (response.ok) return response;
  }
  return null;
}

const router = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith(COLLECTOR_PREFIX)) {
      const rest = url.pathname.slice(COLLECTOR_PREFIX.length);
      if (rest === "refresh") {
        const jobs = (url.searchParams.get("jobs") ?? "").split(",").map((job) => job.trim()).filter(Boolean);
        return Response.json(await env.COLLECTOR_RPC.refresh(jobs));
      }
      const target = new URL(`/__dev/${rest}${url.search}`, "http://collector");
      return env.COLLECTOR.fetch(new Request(target, request));
    }

    if (url.pathname.startsWith("/api/ingest/") || INGRESS_INTERNAL_PATHS.has(url.pathname)) {
      return env.INGRESS.fetch(request);
    }

    if (APPLE_MUSIC_HTTP_PATHS.has(url.pathname)) {
      return (request.method === "GET" && (await devOverride(env, url))) || env.COLLECTOR.fetch(request);
    }

    return env.CORE.fetch(request);
  },

  async scheduled(controller: { scheduledTime: number }, env: Env): Promise<void> {
    const response = await env.COLLECTOR.fetch(`http://collector/__dev/scheduled?time=${controller.scheduledTime}`, { method: "POST" });
    console.log("[dev-router] collector scheduled", response.status, await response.text());
  },
};

export default router;

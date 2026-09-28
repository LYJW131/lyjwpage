/**
 * 本地开发的路由 Worker（只在 `pnpm dev:worker` 里跑，不部署）。
 *
 * wrangler 多配置模式下只有第一个 Worker 拿到端口，其余的只能经 Service Binding 访问，
 * 所以由它按路径分发：
 * - `/api/ingest/*`、`/api/internal/site-deployed`：生产上归 ingest 域名的那几条，转给上报入口
 *   （workers/ingress）。`/api/internal/storage/import` 仍归 api（`pnpm dev:worker:init` 靠它）。
 * - `/__dev/collector/*`：采集 Worker 的调试入口，去掉前缀后转给它（`run?job=`、`scheduled`）；
 *   `/__dev/collector/refresh?jobs=a,b` 改走它的 RPC entrypoint `Collector.refresh()`。
 * - 其余一切（含 `/ws` 的 WebSocket 升级）原样转给 api。
 *
 * `scheduled()`：`curl localhost:8788/cdn-cgi/local/scheduled` 只会触发第一个 Worker，
 * 也就是这里，它再让采集 Worker 按这一刻跑一遍到期的任务。api 的分钟 cron 从这里
 * 触发不到（Service Binding 调不了别的 Worker 的 scheduled），本地它要做的事
 * （读模型、D1 归档、Jev 打分）也都被本地的隔离开关关着。
 *
 * 没有 tsconfig，也不在任何 typecheck 里：只用最基本的类型，保持几十行。
 */

type Fetcher = { fetch(input: Request | string, init?: RequestInit): Promise<Response> };

interface Env {
  API: Fetcher;
  INGRESS: Fetcher;
  COLLECTOR: Fetcher;
  COLLECTOR_RPC: { refresh(jobs: string[]): Promise<unknown> };
}

const COLLECTOR_PREFIX = "/__dev/collector/";
const SITE_DEPLOYED_PATH = "/api/internal/site-deployed";

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

    // 生产上 ingest.homepage.lyjw.llc 的那几条路径
    if (url.pathname.startsWith("/api/ingest/") || url.pathname === SITE_DEPLOYED_PATH) {
      return env.INGRESS.fetch(request);
    }

    return env.API.fetch(request);
  },

  async scheduled(controller: { scheduledTime: number }, env: Env): Promise<void> {
    const response = await env.COLLECTOR.fetch(`http://collector/__dev/scheduled?time=${controller.scheduledTime}`, { method: "POST" });
    console.log("[dev-router] collector scheduled", response.status, await response.text());
  },
};

export default router;

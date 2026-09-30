// Wrangler 多配置模式只有第一个 Worker 获得端口，其余本地入口必须通过绑定转发。

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

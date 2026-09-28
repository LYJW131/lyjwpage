import * as Sentry from "@sentry/cloudflare";
import { WorkerEntrypoint } from "cloudflare:workers";
import type { CollectorJobOutcome, CollectorRpc } from "@shared/collector";

import type { Env } from "./env";
import { runNamed, runScheduled } from "./registry";
import { bindEnv } from "./runtime";
import { reportJobFailure, sentryOptions } from "./sentry";

/**
 * 采集 Worker：所有定时的外部拉取都在这里。只展示的结果直接写可滞后层 KV，
 * 状态核心要拿来算的（PlayStation、最近在听）经 CORE 交过去。任务登记在 registry.ts。
 */
export type { Env } from "./env";

/**
 * 同账号 Worker 经 Service Binding 调的 RPC（契约见 shared/collector.ts），
 * 比如站点部署完成后让它立刻重拉部署列表。
 */
class CollectorBase extends WorkerEntrypoint<Env> implements CollectorRpc {
  async refresh(jobs: string[]): Promise<CollectorJobOutcome[]> {
    return runNamed(bindEnv(this.env), Array.isArray(jobs) ? jobs.filter((job) => typeof job === "string") : [], { report: reportJobFailure });
  }
}

export const Collector = Sentry.withSentry(sentryOptions, CollectorBase);

const notFound = () => Response.json({ ok: false, error: "Not Found" }, { status: 404 });

const collector = {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await runScheduled(bindEnv(env), controller.scheduledTime, { monitor: Sentry.withMonitor, report: reportJobFailure });
  },

  /**
   * 生产上没有 HTTP 入口。只有本地配了 `DEV_TRIGGERS=true` 才开两条调试路由
   * （经 dev-router 的 `/__dev/collector/*` 进来）：
   * - `POST /__dev/run?job=<名字>`：立刻跑一个任务，返回结果；
   * - `POST /__dev/scheduled[?time=<毫秒>]`：当作 cron 在这一刻响了一次，跑到期的那几个，不报到 Sentry。
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    if (env.DEV_TRIGGERS?.trim() !== "true") return notFound();
    const url = new URL(request.url);
    if (request.method !== "POST") return notFound();
    bindEnv(env);
    if (url.pathname === "/__dev/run") {
      const job = url.searchParams.get("job") ?? "";
      const [result] = await runNamed(env, [job]);
      return Response.json(result, { status: result?.status === "error" ? 500 : 200 });
    }
    if (url.pathname === "/__dev/scheduled") {
      const time = Number(url.searchParams.get("time")) || Date.now();
      return Response.json(await runScheduled(env, time));
    }
    return notFound();
  },
};

export default Sentry.withSentry(sentryOptions, collector);

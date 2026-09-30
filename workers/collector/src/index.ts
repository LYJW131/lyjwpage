import * as Sentry from "@sentry/cloudflare";
import { WorkerEntrypoint } from "cloudflare:workers";
import type { CollectorJobOutcome, CollectorRpc } from "@shared/collector";

import type { Env } from "./env";
import { runNamed, runScheduled } from "./registry";
import { bindEnv } from "./runtime";
import { reportJobFailure, sentryOptions } from "./sentry";

export type { Env } from "./env";

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

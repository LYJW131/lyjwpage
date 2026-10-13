import * as Sentry from "@sentry/cloudflare";
import { WorkerEntrypoint } from "cloudflare:workers";
import { APPLE_MUSIC_HTTP_PATHS } from "@shared/apple-music-paths";
import type { CollectorJobOutcome, CollectorRpc } from "@shared/collector";
import type { PlayingQueueTrack } from "@shared/playing-queue";
import type { EnrichmentFollowUp, EnrichmentOutcome } from "@shared/track-enrichment";
import type { LocalNowPlaying } from "@shared/types";

import { serveAppleLookup, serveAppleMusic } from "./apple-music-http";
import { driveCoreRound } from "./core-round";
import { enrichTrack, followUpTrack } from "./enrichment";
import type { Env } from "./env";
import { runNamed, runScheduled } from "./registry";
import { installCollectorPorts } from "./ports";
import { bindEnv } from "./runtime";
import { cronMonitor } from "./schedule";
import { reportJobFailure, sentryOptions } from "./sentry";

export type { Env } from "./env";

installCollectorPorts();

class CollectorBase extends WorkerEntrypoint<Env> implements CollectorRpc {
  async refresh(jobs: string[]): Promise<CollectorJobOutcome[]> {
    return runNamed(bindEnv(this.env), Array.isArray(jobs) ? jobs.filter((job) => typeof job === "string") : [], { report: reportJobFailure });
  }

  async enrichTrack(music: LocalNowPlaying | null, upcomingTracks: PlayingQueueTrack[]): Promise<EnrichmentOutcome | null> {
    bindEnv(this.env);
    return enrichTrack(music, upcomingTracks);
  }

  async followUpTrack(followUp: EnrichmentFollowUp): Promise<void> {
    this.ctx.waitUntil(followUpTrack(bindEnv(this.env), followUp));
  }
}

class AppleLookupsBase extends WorkerEntrypoint<Env> {
  fetch(request: Request): Promise<Response> {
    bindEnv(this.env);
    return serveAppleLookup(request);
  }
}

export const Collector = Sentry.withSentry(sentryOptions, CollectorBase);
export const AppleLookups = Sentry.withSentry(sentryOptions, AppleLookupsBase);

const notFound = () => Response.json({ ok: false, error: "Not Found" }, { status: 404 });

const collector = {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await Promise.all([
      runScheduled(bindEnv(env), controller.scheduledTime, { monitor: cronMonitor(env, Sentry.withMonitor), report: reportJobFailure }),
      driveCoreRound(env.CORE, controller.scheduledTime),
    ]);
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (APPLE_MUSIC_HTTP_PATHS.has(url.pathname)) return serveAppleMusic(request, bindEnv(env));
    if (env.DEV_TRIGGERS?.trim() !== "true") return notFound();
    if (request.method !== "POST") return notFound();
    bindEnv(env);
    if (url.pathname === "/__dev/run") {
      const job = url.searchParams.get("job") ?? "";
      const [result] = await runNamed(env, [job]);
      return Response.json(result, { status: result?.status === "error" ? 500 : 200 });
    }
    if (url.pathname === "/__dev/scheduled") {
      const time = Number(url.searchParams.get("time")) || Date.now();
      const [outcomes] = await Promise.all([runScheduled(env, time), driveCoreRound(env.CORE, time)]);
      return Response.json(outcomes);
    }
    return notFound();
  },
};

export default Sentry.withSentry(sentryOptions, collector);

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
import { isLateRound, runNamed, runScheduled } from "./registry";
import { installCollectorPorts } from "./ports";
import { bindEnv } from "./runtime";

export type { Env } from "./env";

installCollectorPorts();

export class Collector extends WorkerEntrypoint<Env> implements CollectorRpc {
  async refresh(jobs: string[]): Promise<CollectorJobOutcome[]> {
    return runNamed(bindEnv(this.env), Array.isArray(jobs) ? jobs.filter((job) => typeof job === "string") : []);
  }

  async enrichTrack(music: LocalNowPlaying | null, upcomingTracks: PlayingQueueTrack[]): Promise<EnrichmentOutcome | null> {
    bindEnv(this.env);
    return enrichTrack(music, upcomingTracks);
  }

  async followUpTrack(followUp: EnrichmentFollowUp): Promise<void> {
    this.ctx.waitUntil(followUpTrack(bindEnv(this.env), followUp));
  }
}

export class AppleLookups extends WorkerEntrypoint<Env> {
  fetch(request: Request): Promise<Response> {
    bindEnv(this.env);
    return serveAppleLookup(request);
  }
}

const notFound = () => Response.json({ ok: false, error: "Not Found" }, { status: 404 });

const collector = {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    if (isLateRound(controller.scheduledTime)) {
      console.warn(JSON.stringify({ event: "collector-late-round", scheduledTime: controller.scheduledTime, lateMs: Date.now() - controller.scheduledTime }));
      return;
    }
    await Promise.all([
      runScheduled(bindEnv(env), controller.scheduledTime),
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

export default collector;

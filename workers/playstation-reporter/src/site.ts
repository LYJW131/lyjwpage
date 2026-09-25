import { isDryRun, type Env } from "./env";
import type { PlayedGamesReport, PresenceReport } from "./psn";
import type { TrophiesReport } from "./trophies";

export type PlaystationEnvelope = {
  version: 1;
  presence?: PresenceReport;
  playedGames?: PlayedGamesReport;
  trophies?: TrophiesReport;
};

type SiteEnvelope<T> = { ok?: boolean; error?: string; data?: T };
export type Receipt = { changed: boolean };

async function readEnvelope<T>(response: Response): Promise<T | undefined> {
  const body = (await response.json().catch(() => null)) as SiteEnvelope<T> | null;
  if (!response.ok || body?.ok !== true) {
    throw new Error(`站点返回 ${response.status}${body?.error ? `：${body.error}` : ""}`);
  }
  return body.data;
}

export async function deliver(env: Env, envelope: PlaystationEnvelope): Promise<Receipt> {
  if (isDryRun(env)) {
    console.log(JSON.stringify(envelope));
    return { changed: true };
  }

  // 经 Service Binding 直接调 api Worker 的 PlaystationIngest：不走公网，不带凭据，
  // 只有声明了这个 binding 的 Worker 调得到。超时照旧：奖杯那封大，给得宽一些
  const response = await withTimeout(
    env.API!.ingest(JSON.stringify(envelope)),
    envelope.trophies ? 30_000 : 15_000,
  );
  const data = await readEnvelope<{ changed?: boolean }>(response);
  return { changed: data?.changed === true };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`上报超时（${ms} ms）`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

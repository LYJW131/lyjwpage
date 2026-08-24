import { ingestUrl, isDryRun, type Env } from "./env";
import type { PlayedGamesReport, PresenceReport } from "./psn";

export type PlaystationEnvelope = {
  version: 1;
  presence?: PresenceReport;
  playedGames?: PlayedGamesReport;
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

  const secret = env.TELEMETRY_INGEST_SECRET?.trim();
  const response = await fetch(ingestUrl(env), {
    method: "POST",
    headers: {
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(envelope),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await readEnvelope<{ changed?: boolean }>(response);
  return { changed: data?.changed === true };
}

import { isDryRun, type Env } from "./env.js";
import type { PlayedGamesReport, PresenceReport } from "./psn.js";
import type { TrophiesReport } from "./trophies.js";

export type PlaystationEnvelope = {
  version: 1;
  presence?: PresenceReport;
  playedGames?: PlayedGamesReport;
  trophies?: TrophiesReport;
};

export type Receipt = { changed: boolean };

type SiteEnvelope = { ok?: boolean; error?: string; data?: { changed?: unknown } };

export async function deliver(env: Env, envelope: PlaystationEnvelope): Promise<Receipt> {
  if (envelope.version !== 1) throw new Error("PlayStation 遥测协议 version 必须为 1");
  if (isDryRun(env)) {
    console.log(JSON.stringify(envelope));
    return { changed: true };
  }

  const timeoutMs = envelope.trophies ? 30_000 : 15_000;
  const response = await fetch(env.SITE_INGEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Access-Client-Id": env.ACCESS_CLIENT_ID,
      "CF-Access-Client-Secret": env.ACCESS_CLIENT_SECRET,
    },
    body: JSON.stringify(envelope),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await response.json().catch(() => null)) as SiteEnvelope | null;
  if (!response.ok || body?.ok !== true) {
    throw new Error(`站点返回 ${response.status}${body?.error ? `：${body.error}` : ""}`);
  }
  return { changed: body.data?.changed === true };
}

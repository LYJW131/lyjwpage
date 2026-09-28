import { object } from "@/lib/json";
import { normalizeTrophies } from "@/lib/trophies";
import { normalizePlaystationPlayedGames, normalizePlaystationPower, normalizePlaystationPresence } from "@shared/playstation";

/**
 * PlayStation 信封 `{ version: 1, presence?, playedGames?, trophies?, power? }` 的收敛。
 *
 * 两个生产者：采集 Worker（presence / playedGames / trophies，在它自己那边 prepare 完
 * 经 `StateCore.commitIngest` 交给状态核心）和 Home Assistant 的电源开关（`power`，
 * 走 `/api/ingest/playstation`，在上报入口 prepare）。缺席表示这次不谈这一项。
 */
export type PreparedPlaystationReport = {
  source: "playstation";
  receivedAt: number;
  presence: ReturnType<typeof normalizePlaystationPresence> | null;
  playedGames: ReturnType<typeof normalizePlaystationPlayedGames> | null;
  trophies: ReturnType<typeof normalizeTrophies> | null;
  power: ReturnType<typeof normalizePlaystationPower> | null;
};

export function preparePlaystationReport(input: unknown, receivedAt = Date.now()): PreparedPlaystationReport {
  const envelope = object(input);
  if (!envelope || envelope.version !== 1) {
    throw new Error("PlayStation 遥测协议 version 必须为 1");
  }
  return {
    source: "playstation",
    receivedAt,
    presence: "presence" in envelope ? normalizePlaystationPresence(envelope.presence) : null,
    playedGames: "playedGames" in envelope
      ? normalizePlaystationPlayedGames(envelope.playedGames)
      : null,
    trophies: "trophies" in envelope ? normalizeTrophies(envelope.trophies) : null,
    power: "power" in envelope ? normalizePlaystationPower(envelope.power) : null,
  };
}

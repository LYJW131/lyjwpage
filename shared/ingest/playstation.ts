import { object } from "@/lib/json";
import { normalizeTrophies } from "@/lib/trophies";
import { normalizePlaystationPlayedGames, normalizePlaystationPresence } from "@shared/playstation";

/**
 * PlayStation 信封 `{ version: 1, presence?, playedGames?, trophies? }` 的收敛。
 * 缺席表示这次不谈这一项。
 */
export type PreparedPlaystationReport = {
  source: "playstation";
  receivedAt: number;
  presence: ReturnType<typeof normalizePlaystationPresence> | null;
  playedGames: ReturnType<typeof normalizePlaystationPlayedGames> | null;
  trophies: ReturnType<typeof normalizeTrophies> | null;
};

export function preparePlaystationReport(input: unknown, receivedAt = Date.now()): PreparedPlaystationReport {
  const envelope = object(input);
  if (!envelope || envelope.version !== 1) {
    throw new Error("PlayStation 遥测协议 version 必须为 1");
  }
  if ("power" in envelope) throw new Error("PlayStation power 字段不再接受");
  return {
    source: "playstation",
    receivedAt,
    presence: "presence" in envelope ? normalizePlaystationPresence(envelope.presence) : null,
    playedGames: "playedGames" in envelope
      ? normalizePlaystationPlayedGames(envelope.playedGames)
      : null,
    trophies: "trophies" in envelope ? normalizeTrophies(envelope.trophies) : null,
  };
}

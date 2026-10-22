import { INGEST_FUTURE_SKEW_MS } from "@shared/freshness";
import { object } from "@shared/json";
import { normalizeTrophies } from "@shared/trophies";
import { normalizePlaystationPlayedGames, normalizePlaystationPresence } from "@shared/playstation";

export type PreparedPlaystationReport = {
  source: "playstation";
  receivedAt: number;
  presence: ReturnType<typeof normalizePlaystationPresence> | null;
  playedGames: ReturnType<typeof normalizePlaystationPlayedGames> | null;
  trophies: ReturnType<typeof normalizeTrophies> | null;
};

function notFromFuture<T extends { observedAt: number }>(section: T | null, receivedAt: number, name: string): T | null {
  if (section && section.observedAt > receivedAt + INGEST_FUTURE_SKEW_MS) {
    throw new Error(`PlayStation ${name} 的 observedAt 晚于接收时刻`);
  }
  return section;
}

export function preparePlaystationReport(input: unknown, receivedAt = Date.now()): PreparedPlaystationReport {
  const envelope = object(input);
  if (!envelope || envelope.version !== 1) {
    throw new Error("PlayStation 遥测协议 version 必须为 1");
  }
  if ("power" in envelope) throw new Error("PlayStation power 字段不再接受");
  return {
    source: "playstation",
    receivedAt,
    presence: notFromFuture("presence" in envelope ? normalizePlaystationPresence(envelope.presence) : null, receivedAt, "presence"),
    playedGames: notFromFuture(
      "playedGames" in envelope ? normalizePlaystationPlayedGames(envelope.playedGames) : null,
      receivedAt,
      "playedGames",
    ),
    trophies: notFromFuture("trophies" in envelope ? normalizeTrophies(envelope.trophies) : null, receivedAt, "trophies"),
  };
}

import { mirrorKey } from "@/lib/storage";
import { REPORTER_BY_SOURCE, type ReporterName, type ReporterStat } from "@/lib/reporter-ledger";

/** 一周。上报器停了几天再回来，卡片上该说的是「上次那份」和 offline，不是「从没收到过」 */
export const TTL_MS = 7 * 24 * 60 * 60 * 1000;

const mirrors = new Map<ReporterName, ReturnType<typeof mirrorKey<ReporterStat>>>();

export function ledgerMirror(name: ReporterName) {
  let mirror = mirrors.get(name);
  if (!mirror) {
    mirror = mirrorKey<ReporterStat>(["reporter", name], (stat) => stat.lastPushAt, { ttlMs: TTL_MS });
    mirrors.set(name, mirror);
  }
  return mirror;
}

export const REPORTER_NAMES = Object.values(REPORTER_BY_SOURCE) as ReporterName[];

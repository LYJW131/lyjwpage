import { mirrorKey } from "@/lib/storage";
import { REPORTER_BY_SOURCE, type ReporterName, type StoredLedger } from "@/lib/reporter-ledger";

/** 一周。上报器停了几天再回来，账本里那几格早已滑出窗口，留着只为记得上次的提交 */
export const TTL_MS = 7 * 24 * 60 * 60 * 1000;

const mirrors = new Map<ReporterName, ReturnType<typeof mirrorKey<StoredLedger>>>();

export function ledgerMirror(name: ReporterName) {
  let mirror = mirrors.get(name);
  if (!mirror) {
    mirror = mirrorKey<StoredLedger>(["reporter", name], (ledger) => ledger.lastPushAt, { ttlMs: TTL_MS });
    mirrors.set(name, mirror);
  }
  return mirror;
}

export const REPORTER_NAMES = Object.values(REPORTER_BY_SOURCE) as ReporterName[];

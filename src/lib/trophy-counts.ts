import type { TrophyCounts } from "@/lib/types";

export function emptyTrophyCounts(): TrophyCounts {
  return { platinum: 0, gold: 0, silver: 0, bronze: 0 };
}

export function addTrophyCounts(a: TrophyCounts, b: TrophyCounts): TrophyCounts {
  return {
    platinum: a.platinum + b.platinum,
    gold: a.gold + b.gold,
    silver: a.silver + b.silver,
    bronze: a.bronze + b.bronze,
  };
}

export function countTrophies(counts: TrophyCounts): number {
  return counts.platinum + counts.gold + counts.silver + counts.bronze;
}

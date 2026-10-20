import { type TrophyTitle, type UserTrophyProfileSummaryResponse } from "psn-api";

import { nonNegative, percent, type Loose } from "./util.js";

export type TrophyType = "platinum" | "gold" | "silver" | "bronze";

export type TrophyCounts = {
  platinum: number;
  gold: number;
  silver: number;
  bronze: number;
};

export type TrophiesReport = {
  observedAt: number;
  profile: {
    onlineId: string;
    avatarUrl: string | null;
    plus: boolean;
    level: number;
    tier: number;
    trophyPoint: number;
    levelBasePoint: number;
    levelNextPoint: number;
    levelProgress: number;
    earned: TrophyCounts;
  };
  titles: Array<{
    npCommunicationId: string;
    name: string;
    localizedName: string | null;
    titleIds: string[];
    iconUrl: string | null;
    platform: string;
    progress: number;
    defined: TrophyCounts;
    earned: TrophyCounts;
    lastUpdatedAt: number | null;
    playDurationMs: number | null;
    playCount: number;
    firstPlayedAt: number | null;
    lastPlayedAt: number | null;
    service: string | null;
    preOrder: boolean;
    groups: Array<{
      id: string;
      name: string;
      iconUrl: string | null;
      progress: number;
      defined: TrophyCounts;
      earned: TrophyCounts;
    }>;
    trophies: Array<{
      id: number;
      type: TrophyType;
      name: string;
      detail: string | null;
      iconUrl: string | null;
      hidden: boolean;
      groupId: string;
      earned: boolean;
      earnedAt: number | null;
      earnedRate: number | null;
    }>;
  }>;
};

export type TitleIndex = Loose<TrophyTitle> & { npCommunicationId: string };

export type TrophyIndexSnapshot = {
  npCommunicationId: string;
  progress: number;
  lastUpdatedDateTime: string;
  earned: TrophyCounts;
  defined: TrophyCounts;
};

export type TrophyTitleReport = TrophiesReport["titles"][number];

// psn-api 的响应类型漏了上游的点数字段。
export type TrophySummary = Loose<
  UserTrophyProfileSummaryResponse & {
    trophyPoint: number;
    trophyLevelBasePoint: number;
    trophyLevelNextPoint: number;
  }
>;

const TROPHY_TYPES = new Set<string>(["platinum", "gold", "silver", "bronze"]);

export function isTrophyType(value: string): value is TrophyType {
  return TROPHY_TYPES.has(value);
}

export function counts(raw: Loose<TrophyCounts> | undefined): TrophyCounts {
  return {
    platinum: nonNegative(raw?.platinum),
    gold: nonNegative(raw?.gold),
    silver: nonNegative(raw?.silver),
    bronze: nonNegative(raw?.bronze),
  };
}

export function rate(raw: string | number | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "string" && !raw.trim()) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? percent(parsed) : null;
}

export function countsEqual(a: TrophyCounts, b: TrophyCounts): boolean {
  return (
    a.platinum === b.platinum && a.gold === b.gold && a.silver === b.silver && a.bronze === b.bronze
  );
}

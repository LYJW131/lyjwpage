export type PlaystationGame = {
  titleId: string;
  name: string;
  category: string | null;
  playCount: number;
  firstPlayedAt: number | null;
  lastPlayedAt: number | null;
  playDurationMs: number | null;
  imageUrl: string | null;
  service: string | null;
  preOrder: boolean;
};

export type PlaystationPlayingPayload = {
  observedAt: number;
  items: PlaystationGame[];
};

export type PlaystationNowPlaying = {
  titleId: string;
  title: string;
  format: string | null;
  launchPlatform: string | null;
  iconUrl: string | null;
};

export type PlaystationPowerPayload = {
  on: boolean;
  observedAt: number;
  entityId: string | null;
};

export type PlaystationPresencePayload = {
  observedAt: number;
  online: boolean;
  availability: string | null;
  platform: string | null;
  lastOnlineAt: number | null;
  playing: PlaystationNowPlaying | null;
};

export const TROPHY_TYPES = ["platinum", "gold", "silver", "bronze"] as const;
export type TrophyType = (typeof TROPHY_TYPES)[number];

export type TrophyCounts = {
  platinum: number;
  gold: number;
  silver: number;
  bronze: number;
};

export type TrophyProfile = {
  onlineId: string;
  avatarUrl: string | null;
  plus: boolean;
  level: number;
  tier: number;
  trophyPoint: number;
  levelBasePoint: number;
  levelNextPoint: number;
  // 当前等级内的百分比进度，0–100。
  levelProgress: number;
  earned: TrophyCounts;
};

export type TrophyGroup = {
  id: string;
  name: string;
  iconUrl: string | null;
  progress: number;
  defined: TrophyCounts;
  earned: TrophyCounts;
};

export type Trophy = {
  id: number;
  type: TrophyType;
  name: string;
  detail: string | null;
  iconUrl: string | null;
  hidden: boolean;
  groupId: string;
  earned: boolean;
  // epoch 毫秒；未解锁为 null。
  earnedAt: number | null;
  // 全球持有率，0–100。
  earnedRate: number | null;
};

export type TrophyTitle = {
  // 奖杯 API 的键，不是游玩列表的 titleId（PPSA…）；titleIds 是对齐到这张奖杯表的游戏 SKU，同一奖杯组可对应多个，不能互换或假定一对一。
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
  groups: TrophyGroup[];
  trophies: Trophy[];
};

export type TrophiesPayload = {
  observedAt: number;
  profile: TrophyProfile;
  titles: TrophyTitle[];
};

export type TrophyUnlock = {
  npCommunicationId: string;
  id: number;
  groupId: string;
  titleName: string;
  trophyName: string;
  type: TrophyType;
  iconUrl: string | null;
  earnedAt: number;
};

export type TrophyTitleDigest = {
  npCommunicationId: string;
  name: string;
  localizedName: string | null;
  titleIds: string[];
  progress: number;
  defined: TrophyCounts;
  earned: TrophyCounts;
};

export type TrophiesSummaryPayload = {
  observedAt: number;
  profile: TrophyProfile;
  earned: TrophyCounts;
  recent: TrophyUnlock[];
  titles: TrophyTitleDigest[];
};

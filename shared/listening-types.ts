import type { ReporterPresence } from "@shared/types";

export type ListeningItem = {
  id: string;
  title: string;
  artist: string;
  artwork: string | null;
  link: string | null;
  palette: string[];
  // 条目是专辑、歌单或电台这类容器，不是单曲；durationMs 是容器内曲目总时长，只为列表首项计算（算它要再查一次上游，页面也只显示首项）。
  durationMs: number | null;
  motion?: TrackMotion | null;
};

export type TrackMotion = {
  videoUrl: string;
  colors: string[] | null;
};

export type RecentTrack = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs?: number | null;
  songId?: string | null;
  artworkUrl?: string | null;
};

// Apple「最近播放」最前那个歌单 / 专辑里可播的歌，按容器里的顺序。id 是资源 id（同 ListeningItem.id）。
export type PlayingContainer = {
  id: string;
  tracks: PlayingContainerTrack[];
};

export type PlayingContainerTrack = Pick<RecentTrack, "id" | "title" | "artist"> & {
  songId: string | null;
  durationMs: number | null;
  artworkUrl: string | null;
};

export type ListeningPayload = {
  items: ListeningItem[];
  // 源站最近一次拉到这份列表的 epoch 毫秒，用来拒绝晚到的旧响应，不是过期判据：几分钟前的「最近在听」不算错，不该变灰。
  fetchedAt: number;
};

export type LocalNowPlaying = {
  source: "apple-music" | "homepod";
  state: "playing" | "paused" | "stopped";
  title: string | null;
  artist: string | null;
  album: string | null;
  trackId: string | null;
  artworkUrl: string | null;
  positionMs: number;
  durationMs: number;
  repeatOne: boolean;
  observedAt: number;
};

export type NowListeningAlternate = {
  music: LocalNowPlaying;
  id: string | null;
  link: string | null;
  songId: string | null;
  upcomingSongIds: string[];
  hasLyrics: boolean;
  motion: TrackMotion | null;
};

export type NowListeningPayload = ReporterPresence & {
  music: LocalNowPlaying | null;
  receivedAt: number | null;
  idle: boolean;
  // 与 ListeningPayload.items[].id 对应的专辑 / 歌单资源 ID，不是单曲。
  id: string | null;
  link: string | null;
  // 目录里单曲本身的 ID，供「一起听」用 MusicKit 点播；匹配不到可播放的目录曲目时为 null。
  songId: string | null;
  upcomingSongIds: string[];
  hasLyrics: boolean;
  motion: TrackMotion | null;
  // 源站算出的暂停宽限剩余毫秒，到期应重取；null 表示没有这类定时失效。客户端不要拿设备的 observedAt 自行重算。
  expiresInMs: number | null;
  alternate: NowListeningAlternate | null;
  // 没有上报器的 Apple Music 播放（iPhone、iPad、网页版等）推断出来正在放的那首；Mac / HomePod 在放同名歌时为 null。可能缺席（Worker 先后上线）。
  elsewhere?: NowListeningElsewhere | null;
};

// startedAt 是推断的开播 epoch 毫秒，marginMs 是它的理想误差半宽（连续播放、上榜滞后恒定时）；放到 startedAt + durationMs 为止，
// 之后再给 LISTENING_ELSEWHERE_HOLD_MS 等下一首被看见。
export type NowListeningElsewhere = {
  title: string;
  artist: string | null;
  album: string | null;
  artworkUrl: string | null;
  songId: string | null;
  startedAt: number;
  durationMs: number;
  marginMs: number;
  // 照规则推出的下一首；随机播放或证据不够时为 null。可能缺席（Worker 先后上线）。
  next?: NowListeningNext | null;
};

// basis：loop 是最近几首按同样顺序完整重复过一轮，order 是正按所在歌单 / 专辑的顺序往下放。
export type NowListeningNext = {
  title: string;
  artist: string | null;
  songId: string | null;
  artworkUrl: string | null;
  durationMs: number | null;
  basis: "loop" | "order";
  // 当这首已放完再往下猜的一首，只给一层（then 里不再带 then）；猜不出时为 null。可能缺席（Worker 先后上线）。
  then?: NowListeningNext | null;
};

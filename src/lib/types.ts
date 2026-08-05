/** 三个状态源统一的对外数据契约 —— 前端只认这里的类型。 */

export type WatchingItem = {
  id: string;
  /** 剧名（剧集）或片名（电影） */
  title: string;
  /** 「S01E05 · 集标题」之类的副标题，电影为空 */
  subtitle: string;
  /** 0–100 */
  progress: number;
  /** 竖版海报 */
  poster: string | null;
  /** 横版背景图，做卡片底图用 */
  backdrop: string | null;
  type: "Episode" | "Movie" | "Series" | "Other";
  year: number | null;
  /** 直接跳到 Emby 播放页 */
  link: string | null;
  /** 上次播放时间 ISO 字符串 */
  playedAt: string | null;
};

export type ListeningItem = {
  id: string;
  title: string;
  /** 「艺人 · 专辑」 */
  subtitle: string;
  artist: string;
  album: string;
  artwork: string | null;
  /** Apple 给的封面主色，形如 "1a1a1a"（不带 #） */
  accent: string | null;
  durationMs: number | null;
  link: string | null;
};

export type ChargerPort = {
  /** C1 / C2 / C3 */
  id: string;
  /** 该口是否正在输出（≠ 充电器整体是否在线） */
  active: boolean;
  /** 瓦，未输出时为 null */
  power: number | null;
  /** 伏，未输出时为 null */
  voltage: number | null;
  /** 安，未输出时为 null */
  current: number | null;
  /** 设备名，优先 model 再退 vendor，如 "MacBook Pro series" */
  device: string | null;
  /** 快充协议，如 "Apple PD Fast Charging" */
  protocol: string | null;
  /** 线缆能力等级，如 "EPR-240W MAX" */
  cable: string | null;
};

export type ChargerStatus = {
  /** BLE 会话是否活着 */
  connected: boolean;
  /** 整机输出功率（瓦） */
  totalPower: number;
  /** 额定最大功率，用来算功率条比例（Anker Prime 160W） */
  maxPower: number;
  ports: ChargerPort[];
  device: {
    serialNumber: string | null;
    firmwareVersion: string | null;
  };
  /** 遥测采集时刻，毫秒时间戳 */
  updatedAt: number | null;
};

/** 所有 /api/status/* 的统一信封 */
export type StatusResponse<T> =
  | { ok: true; data: T; fetchedAt: string }
  | { ok: false; error: string; fetchedAt: string };

// 只读、不公开的长期历史：core 的 PrivateHistory 入口读 D1 lyjwpage-history，不经站点网关，调用方见 workers/core/README.md「AI 路由与公开状态 RPC」。
// time 是按时间筛选与排序的列：ms 为 epoch 毫秒，day 为站点日（Asia/Shanghai）的 YYYY-MM-DD。
export const PRIVATE_HISTORY_TABLES = {
  listening_plays: { time: "started_at", unit: "ms", about: "Every music play: Mac/HomePod measured spans (certain=1) and Apple Music recently-played windows (certain=0); title, artist, album" },
  watching_sessions: { time: "started_at", unit: "ms", about: "Emby viewing sessions per item, with seconds actually playing" },
  game_sessions: { time: "started_at", unit: "ms", about: "Time spent in a game (PlayStation, Quest)" },
  charging_sessions: { time: "started_at", unit: "ms", about: "Each charge: start, end, peak watts, energy Wh, charged device name" },
  charging_samples: { time: "t", unit: "ms", about: "Measured charger watts with the device being charged" },
  workouts: { time: "started_at", unit: "ms", about: "Apple Watch workouts incl. average and max heart rate" },
  activity_days: { time: "date", unit: "day", about: "Daily activity ring totals and goals, steps, distance, flights" },
  activity_buckets: { time: "started_at", unit: "ms", about: "HealthKit 5-minute buckets: steps, active kcal, exercise minutes" },
  coding_observations: { time: "t", unit: "ms", about: "Mac foreground app, whether it is a coding app, and which agents/models were running" },
  coding_usage_days: { time: "date", unit: "day", about: "Daily token usage and API-equivalent cost per source and agent" },
  coding_usage_models: { time: "date", unit: "day", about: "Daily tokens per source, agent and model" },
  coding_usage_buckets: { time: "bucket_at", unit: "ms", about: "5-minute token buckets per source, agent and model" },
  coding_active_days: { time: "date", unit: "day", about: "Seconds each agent/model was running per day" },
  limit_snapshots: { time: "date", unit: "day", about: "Daily last reading of every coding plan limit, with plan" },
  limit_hours: { time: "hour_at", unit: "ms", about: "Hourly last reading of every coding plan limit" },
  server_hours: { time: "hour_at", unit: "ms", about: "Server hourly summary: CPU, load, memory, disk, peak network rates, NIC counters, traffic, uptime" },
  trophies: { time: "earned_at", unit: "ms", about: "Every earned PlayStation trophy with rarity" },
  site_deploys: { time: "created_at", unit: "ms", about: "Every site build seen: state, duration, commit" },
  watching_events: { time: "observed_at", unit: "ms", about: "Every Emby report that carries playing state: item, paused, position, client, device, play method, media spec (JSON); item_id NULL means stopped" },
  game_play_snapshots: { time: "observed_at", unit: "ms", about: "PlayStation cumulative play time and count per title, one row each time they change" },
  trophy_profile_days: { time: "date", unit: "day", about: "PlayStation trophy level, points and earned counts per day" },
  quest_activities: { time: "first_seen_at", unit: "ms", about: "Quest rich presence per game session: details and state text, first and last seen" },
  homepod_events: { time: "observed_at", unit: "ms", about: "Every HomePod report that names its Home Assistant entity (which HomePod): state, track, position" },
  powerbank_minutes: { time: "minute_at", unit: "ms", about: "Power bank per minute: battery, health, charging, input and output watts, temperature" },
  charging_port_minutes: { time: "minute_at", unit: "ms", about: "Charger active ports per minute: watts, volts, amps, protocol, cable, device" },
  desktop_changes: { time: "t", unit: "ms", about: "Mac foreground app changes: name, bundle id, published window title" },
  timezone_changes: { time: "t", unit: "ms", about: "Mac time zone changes" },
  focus_changes: { time: "t", unit: "ms", about: "iPhone Focus mode changes; mode NULL means Focus off" },
  server_identity: { time: "first_seen_at", unit: "ms", about: "Server public IP, location, OS and kernel, one row per combination with first and last seen" },
} as const satisfies Record<string, { time: string; unit: "ms" | "day"; about: string }>;

export type PrivateHistoryTable = keyof typeof PRIVATE_HISTORY_TABLES;
export const PRIVATE_HISTORY_TABLE_NAMES = Object.keys(PRIVATE_HISTORY_TABLES) as PrivateHistoryTable[];
export const PRIVATE_HISTORY_MAX_ROWS = 500;

// from 含、to 不含，都是 epoch 毫秒；day 表取 from 与 to 前一毫秒所在的站点日，两端的日子都含。行按 time 列从新到旧。
export type PrivateHistoryQuery = { table: PrivateHistoryTable; from: number; to: number; limit: number };
export type PrivateHistoryResult =
  | { ok: true; rows: Record<string, unknown>[]; truncated: boolean }
  | { ok: false; error: string };

export interface PrivateHistoryRpc {
  readHistory(query: PrivateHistoryQuery): Promise<PrivateHistoryResult>;
}

export function isPrivateHistoryTable(value: unknown): value is PrivateHistoryTable {
  return typeof value === "string" && Object.hasOwn(PRIVATE_HISTORY_TABLES, value);
}

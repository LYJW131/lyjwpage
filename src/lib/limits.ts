
export const CHARGER_HISTORY_LIMIT = 400;

export const LIVE_INTERVAL_MS = 1_000;
export const LIVE_WINDOW_MS = 2 * 60 * 1000;

export const PULSE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const PULSE_REPEAT_AFTER_MS = 5 * 60 * 1000;

export const PULSE_WINDOW_MS = 24 * 60 * 60 * 1000;

export const PULSE_SILENT_AFTER_MS = 2 * PULSE_REPEAT_AFTER_MS;

// 推断出来的别处播放按时长放完后还留着的时长：下一首要过上榜滞后、再等一轮活跃档拉取才会被看见，留着免得换歌时先闪回最近播放。
export const LISTENING_ELSEWHERE_HOLD_MS = 35_000;

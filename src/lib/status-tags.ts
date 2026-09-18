import { STATUS_VIEWS } from "@/lib/status-views";

/** 展示变化主题；Vercel 只使用 page:<tag> 缓存标签。值来自登记表。 */
export const DESKTOP_TAG = STATUS_VIEWS.desktop.tag;
export const TIMEZONE_TAG = STATUS_VIEWS.timezone.tag;
export const CHARGER_TAG = STATUS_VIEWS.charger.tag;
export const POWERBANK_TAG = STATUS_VIEWS.powerBank.tag;
export const VIBECODING_TAG = STATUS_VIEWS.vibeCoding.tag;
export const VIBECODING_YEAR_TAG = STATUS_VIEWS.vibeCodingYear.tag;
export const LISTENING_TAG = STATUS_VIEWS.listening.tag;
export const NOW_LISTENING_TAG = STATUS_VIEWS.nowListening.tag;
export const ACTIVITY_TAG = STATUS_VIEWS.activity.tag;
export const SERVER_TAG = STATUS_VIEWS.server.tag;
export const WATCHING_TAG = STATUS_VIEWS.watching.tag;
export const NOW_WATCHING_TAG = STATUS_VIEWS.nowWatching.tag;
export const PLAYING_TAG = STATUS_VIEWS.playing.tag;
export const NOW_PLAYING_TAG = STATUS_VIEWS.playingNow.tag;
export const TROPHIES_TAG = STATUS_VIEWS.trophies.tag;

export { STATUS_TAGS } from "@/lib/status-views";

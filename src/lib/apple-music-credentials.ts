import { type StoredAppleMusicCredentialState, mirror } from "@shared/apple-music-credentials";

/**
 * Mac 上报器送来的 Apple Music 凭据：music user token。
 *
 * 它只能来自那台 Mac —— 是用户在 MusicKit 里授权资料库的产物，服务器签不出来。
 * developer token 则相反：api Worker 用自己那把 .p8 现签，过半衰期自动换新
 * （见 lib/apple-music 的 resolveCredentials），不再经过上报器。上报器每五分钟
 * 重读一次 MusicKit 缓存的 user token，变了才发；这边只负责收下最新的一份。
 *
 * 和 telemetryState 分开存，只是复用统一遥测入口接收。
 */
export type StoredAppleMusicCredentials = StoredAppleMusicCredentialState;

/**
 * 带原因的读取。
 *
 * 「SQLite 连不上」和「上报器还没授权过」都表现为拿不到凭据，但修法完全相反 ——
 * 前者去看 SQLite，后者去点授权按钮。报错里指错方向会白白浪费一轮排查，实测
 * 遇到过：凭据明明在 SQLite 里，只是容器重建那几秒断连，页面却说「去授权」。
 */
export async function readAppleMusicCredentials(): Promise<
  | { ok: true; credentials: StoredAppleMusicCredentials }
  | { ok: false; reason: "storage-unreachable" | "never-pushed" }
> {
  const stored = await mirror.get();
  if (stored?.musicUserToken) return { ok: true, credentials: stored };
  return { ok: false, reason: (await mirror.reachable()) ? "never-pushed" : "storage-unreachable" };
}

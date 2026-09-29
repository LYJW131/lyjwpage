import type { AppleMusicCredentialsResult } from "@shared/credentials";

/**
 * Mac 上报器送来的 Apple Music music user token，存在凭据 KV（见 shared/credentials.ts）。
 *
 * 它只能来自那台 Mac —— 是用户在 MusicKit 里授权资料库的产物，服务器签不出来；
 * developer token 则由 api Worker 用自己那把 .p8 现签。上报器定期重读一次
 * MusicKit 缓存的 user token，变了才发。
 *
 * 站点不绑凭据 KV，这里只能抛错。读凭据的地方（拉最近在听、查歌词与曲目）都在
 * Worker 里，各自用路径别名把 `@/lib/apple-music-credentials` 指到读 KV 的实现，
 * 和 `@/lib/apple-developer-token` 同一套做法。
 */
export async function readAppleMusicCredentials(): Promise<AppleMusicCredentialsResult> {
  throw new Error("Apple Music 凭据只在 Worker 上读取；站点不绑凭据 KV");
}

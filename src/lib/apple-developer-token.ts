/**
 * 站点不持有 Apple Music 的 .p8 私钥（见 README 的「MusicKit developer token」一节），
 * 所以这里只能抛错。真正的实现在 workers/api/src/apple-developer-token.ts，Worker 用
 * 路径别名把 `@/lib/apple-developer-token` 指过去，和 `@/lib/storage-driver` 同一套做法。
 *
 * 站点没有任何代码路径会走到这里：调 Apple Music API 的两处（找曲目链接、拉最近
 * 播放）都在 Worker。留这个桩只是让 lib/apple-music 在站点里也能通过类型检查。
 */
export async function appleDeveloperToken(): Promise<string> {
  throw new Error("developer token 只在 api Worker 上签发；站点不持有私钥");
}

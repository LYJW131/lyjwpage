import { appleMusicCredentialsResult, type AppleMusicCredentialsResult } from "@shared/credentials";
import { currentContext } from "./runtime";

/**
 * `@/lib/apple-music-credentials` 在 api Worker 里的实现：读凭据 KV。
 * 歌词与「此刻在听」的曲目查询要用 music user token。
 */
export async function readAppleMusicCredentials(): Promise<AppleMusicCredentialsResult> {
  return appleMusicCredentialsResult(currentContext().env.CREDENTIALS);
}

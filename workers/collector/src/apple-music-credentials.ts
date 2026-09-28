import { appleMusicCredentialsResult, type AppleMusicCredentialsResult } from "@shared/credentials";

import { currentEnv } from "./runtime";

/**
 * `@/lib/apple-music-credentials` 在采集 Worker 里的实现：读凭据 KV 里 Mac 推来的
 * music user token。拉「最近在听」要用它。
 */
export async function readAppleMusicCredentials(): Promise<AppleMusicCredentialsResult> {
  return appleMusicCredentialsResult(currentEnv().CREDENTIALS);
}

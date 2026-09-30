import type { AppleMusicCredentialsResult } from "@shared/credentials";

// 私人凭据只能在 Worker 内读取；站点路径保留失败入口，避免引入公开读取通道。
export async function readAppleMusicCredentials(): Promise<AppleMusicCredentialsResult> {
  throw new Error("Apple Music 凭据只在 Worker 上读取；站点不绑凭据 KV");
}

/**
 * 信封里 `appleMusicCredentials` 模块的校验。
 *
 * 只认 `musicUserToken`。`developerToken` / `expiresAt` 从前也走这条，2026-09-11 起
 * developer token 由 Worker 自签（见 musickit-token.ts 的 issueApiDeveloperToken），
 * 这两个键再出现就是旧版上报器 —— 直接拒掉而不是静默忽略，和当年停用 `iconData`
 * 是同一种处理：把「你在跑旧合同」说出来，比收下一半让人误以为一切正常要好。
 */
export function parseAppleMusicCredentials(value: unknown): { musicUserToken: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("appleMusicCredentials 必须是对象");
  }
  const row = value as Record<string, unknown>;
  if ("developerToken" in row || "expiresAt" in row) {
    throw new Error("appleMusicCredentials.developerToken 已停用：developer token 由 Worker 自签，只上报 musicUserToken");
  }
  const musicUserToken = typeof row.musicUserToken === "string" ? row.musicUserToken.trim() : "";
  if (!musicUserToken) throw new Error("appleMusicCredentials.musicUserToken 不能为空");
  return { musicUserToken };
}

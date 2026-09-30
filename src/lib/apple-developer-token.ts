// 此入口故意抛错；签发能力仅由 Worker 路径别名提供，站点不持有私钥。
export async function appleDeveloperToken(): Promise<string> {
  throw new Error("developer token 只在 api Worker 上签发；站点不持有私钥");
}

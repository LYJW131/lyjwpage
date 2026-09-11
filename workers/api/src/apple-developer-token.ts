import { issueApiDeveloperToken } from "./musickit-token";
import { currentContext } from "./runtime";

/**
 * `@/lib/apple-developer-token` 在 Worker 里的实现。
 *
 * 站点侧的同名模块只会抛错 —— 私钥只在这个 Worker 上。路径别名和 storage-driver
 * 是同一套做法：wrangler.toml 的 [alias] 管打包，tsconfig 的 paths 管类型。
 */
export async function appleDeveloperToken(): Promise<string> {
  return (await issueApiDeveloperToken(currentContext().env)).token;
}

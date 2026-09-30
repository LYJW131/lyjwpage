import { commitSha } from "@/lib/build-info";
import type { AppVersionPayload } from "@/lib/app-version";

// 此端点必须回答生产域名当前部署；开启 Vercel Skew Protection 时须绕开旧部署粘连。
export function GET() {
  const payload: AppVersionPayload = {
    commit: commitSha,
    message: process.env.VERCEL_GIT_COMMIT_MESSAGE?.split("\n")[0].trim().slice(0, 180) || null,
    builtAt: process.env.BUILD_TIME || null,
  };
  return Response.json(payload);
}

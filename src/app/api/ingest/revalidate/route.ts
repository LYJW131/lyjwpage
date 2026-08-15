import { ingestFailed, ingestRoute, jsonBody } from "@/lib/api";
import { object } from "@/lib/json";
import { expireStatusLocally, isStatusTag } from "@/lib/live-events";
import { telemetryAuthorized } from "@/lib/telemetry";

/**
 * 对端源站来刷本部署的 `'use cache'`。
 *
 * Vercel 和 EdgeOne 各有一份 Next 数据缓存，`revalidateTag` 过不了海。上报落在
 * 哪边，哪边就 POST 这里，只动本地 tag，不再通知别人 —— 再传就会打成环。
 */
export async function POST(request: Request) {
  if (!telemetryAuthorized(request)) return ingestFailed("未授权", 401);
  return ingestRoute(async () => {
    const body = object(await jsonBody(request));
    if (!body) throw new Error("请求体必须是对象");
    if (!Array.isArray(body.tags)) throw new Error("tags 必须是数组");
    const tags = body.tags.filter((tag): tag is string => typeof tag === "string" && isStatusTag(tag));
    if (!tags.length) throw new Error("tags 必须包含已知的状态缓存名");
    expireStatusLocally(tags, body.immediate === true);
    return { tags, immediate: body.immediate === true };
  });
}

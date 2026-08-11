import { ingestFailed, ingestRoute, jsonBody } from "@/lib/api";
import { recordHomePodEvent } from "@/lib/homepod-store";
import { publishListening, telemetryAuthorized } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Home Assistant pushes HomePod track and playback-state changes here. */
export async function POST(request: Request) {
  if (!telemetryAuthorized(request)) return ingestFailed("未授权", 401);
  return ingestRoute(async () => {
    const stored = await recordHomePodEvent(await jsonBody(request));
    // HomePod 只影响播放，不碰前台应用
    await publishListening();
    return { source: stored.music.source, state: stored.music.state };
  });
}

import { recordHomePodEvent } from "@/lib/homepod-store";
import { telemetryAuthorized } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Home Assistant pushes HomePod track and playback-state changes here. */
export async function POST(request: Request) {
  if (!telemetryAuthorized(request)) return new Response("未授权", { status: 401 });
  try {
    const stored = await recordHomePodEvent(await request.json());
    return Response.json(
      { accepted: true, source: stored.music.source, state: stored.music.state },
      { status: 202 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(message, { status: 400 });
  }
}

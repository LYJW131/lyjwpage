import { getActivityAsset } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/status/activity/assets/[id]">,
) {
  const { id } = await context.params;
  const asset = getActivityAsset(id);
  if (!asset) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(asset.body), {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": asset.contentType,
    },
  });
}

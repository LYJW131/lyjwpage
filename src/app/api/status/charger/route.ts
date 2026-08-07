import { getChargerPayload } from "@/lib/anker";
import { statusRoute } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("since");
  const parsed = raw == null ? Number.NaN : Number(raw);
  const since = Number.isFinite(parsed) ? parsed : undefined;
  return statusRoute(() => getChargerPayload({ since }));
}

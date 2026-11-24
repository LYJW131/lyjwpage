import { serveFeed } from "@/lib/feed/response";
import { siteContext } from "@/server/site-context";

import type { Route } from "./+types/atom";

export function loader({ request, context }: Route.LoaderArgs) {
  return serveFeed(request, context.get(siteContext), "atom");
}

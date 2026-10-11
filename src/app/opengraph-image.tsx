import type { LoaderFunctionArgs } from "react-router";

import { GENERATED_ASSET_CACHE_CONTROL } from "@/lib/site-policy";
import { siteAssetResponse } from "@/server/site-asset";

export async function loader({ context }: LoaderFunctionArgs) {
  return siteAssetResponse(context, "/site-assets/opengraph.png", GENERATED_ASSET_CACHE_CONTROL);
}

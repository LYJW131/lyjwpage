import type { LoaderFunctionArgs } from "react-router";

import { STABLE_ASSET_CACHE_CONTROL } from "@/lib/site-policy";
import { siteAssetResponse } from "@/server/site-asset";

export async function loader({ context }: LoaderFunctionArgs) {
  return siteAssetResponse(context, "/site-assets/apple-icon.png", STABLE_ASSET_CACHE_CONTROL);
}

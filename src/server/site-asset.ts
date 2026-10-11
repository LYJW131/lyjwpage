import type { RouterContextProvider } from "react-router";

import { NO_STORE } from "@/lib/site-policy";
import { siteContext } from "@/server/site-context";

export async function siteAssetResponse(
  context: Readonly<RouterContextProvider>,
  path: string,
  cacheControl: string,
): Promise<Response> {
  const response = await context.get(siteContext).asset(path);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", response.ok ? cacheControl : NO_STORE);
  return new Response(response.body, { status: response.status, headers });
}

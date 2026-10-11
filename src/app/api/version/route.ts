import { commitSha } from "@/lib/build-info";
import type { AppVersionPayload } from "@/lib/app-version";
import { VERSION_CACHE_CONTROL } from "@/lib/site-policy";

export function loader() {
  const payload: AppVersionPayload = {
    commit: commitSha,
    message: process.env.COMMIT_MESSAGE?.split("\n")[0].trim().slice(0, 180) || null,
    builtAt: process.env.BUILD_TIME || null,
  };
  return Response.json(payload, {
    headers: { "Cache-Control": VERSION_CACHE_CONTROL },
  });
}

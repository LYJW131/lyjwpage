import { PREVIEW_REVISION_PATH } from "./preview-worker-name.mjs";

const READY_PATH = "/api/status/listening/now";

export async function findMatchingPreview(origins, commitSha, fetchImpl = fetch) {
  if (!commitSha) return null;
  try {
    return await Promise.any(origins.map(async (origin) => {
      const options = { signal: AbortSignal.timeout(25_000), cache: "no-store", redirect: "error" };
      const revision = await fetchImpl(`${origin}${PREVIEW_REVISION_PATH}`, options);
      if (!revision.ok || (await revision.json()).commitSha !== commitSha) throw new Error("Preview revision mismatch");
      const ready = await fetchImpl(`${origin}${READY_PATH}`, options);
      if (!ready.ok) throw new Error("Preview not ready");
      await ready.body?.cancel();
      return origin;
    }));
  } catch {
    return null;
  }
}

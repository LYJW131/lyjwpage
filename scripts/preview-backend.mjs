import { PREVIEW_REVISION_PATH } from "./preview-worker-name.mjs";

const READY_PATH = "/api/status/listening/now";

export async function isMatchingPreview(origin, commitSha, fetchImpl = fetch) {
  if (!origin || !commitSha) return false;
  const options = { signal: AbortSignal.timeout(25_000), cache: "no-store", redirect: "error" };
  try {
    const revision = await fetchImpl(`${origin}${PREVIEW_REVISION_PATH}`, options);
    if (!revision.ok || (await revision.json()).commitSha !== commitSha) return false;
    const ready = await fetchImpl(`${origin}${READY_PATH}`, options);
    await ready.body?.cancel();
    return ready.ok;
  } catch {
    return false;
  }
}

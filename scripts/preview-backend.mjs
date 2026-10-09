import { PREVIEW_REVISION_PATH } from "./preview-worker-name.mjs";

const READY_PATH = "/api/status/listening/now";
// 靠后的候选先就绪时再等靠前的这么久：分支 Secret 约定设在 api 那份 Preview 上，两份都在时要稳定选它，
// 又不能为一个失联的候选拖满整段等待。
const PREFERRED_GRACE_MS = 5_000;

async function checkPreview(origin, commitSha, fetchImpl) {
  const options = { signal: AbortSignal.timeout(25_000), cache: "no-store", redirect: "error" };
  const revision = await fetchImpl(`${origin}${PREVIEW_REVISION_PATH}`, options);
  if (!revision.ok || (await revision.json()).commitSha !== commitSha) throw new Error("Preview revision mismatch");
  const ready = await fetchImpl(`${origin}${READY_PATH}`, options);
  if (!ready.ok) throw new Error("Preview not ready");
  await ready.body?.cancel();
  return origin;
}

// origins 按优先顺序排列。
export async function findMatchingPreview(origins, commitSha, fetchImpl = fetch, graceMs = PREFERRED_GRACE_MS) {
  if (!commitSha) return null;
  const checks = origins.map((origin) => checkPreview(origin, commitSha, fetchImpl));
  let first;
  try {
    first = await Promise.any(checks.map((check, index) => check.then(() => index)));
  } catch {
    return null;
  }
  if (first === 0) return origins[0];
  let timer;
  const preferred = await Promise.race([
    Promise.any(checks.slice(0, first).map((check, index) => check.then(() => index))).catch(() => null),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), graceMs);
    }),
  ]);
  clearTimeout(timer);
  return origins[preferred ?? first];
}

import { PREVIEW_REVISION_PATH } from "./preview-worker-name.mjs";

const READY_PATH = "/api/status/listening/now";
// 靠后的候选先就绪时，在这段时间里反复重查靠前的：分支 Secret 约定设在 api 那份 Preview 上，两份一起构建时 api 常常晚到，
// 此前它还挂着旧提交、一查就不匹配；又不能为一个失联的候选拖满 build.mjs 的整段等待。
const PREFERRED_GRACE_MS = 30_000;
const RECHECK_MS = 3_000;

async function checkPreview(origin, commitSha, fetchImpl) {
  const options = { signal: AbortSignal.timeout(25_000), cache: "no-store", redirect: "error" };
  const revision = await fetchImpl(`${origin}${PREVIEW_REVISION_PATH}`, options);
  if (!revision.ok || (await revision.json()).commitSha !== commitSha) throw new Error("Preview revision mismatch");
  const ready = await fetchImpl(`${origin}${READY_PATH}`, options);
  if (!ready.ok) throw new Error("Preview not ready");
  await ready.body?.cancel();
  return origin;
}

function firstReady(checks) {
  return Promise.any(checks.map((check, index) => check.then(() => index)));
}

function delay(ms) {
  let timer;
  const promise = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

// origins 按优先顺序排列。
export async function findMatchingPreview(origins, commitSha, fetchImpl = fetch, graceMs = PREFERRED_GRACE_MS, recheckMs = RECHECK_MS) {
  if (!commitSha) return null;
  const check = (origin) => checkPreview(origin, commitSha, fetchImpl);
  let first;
  try {
    first = await firstReady(origins.map(check));
  } catch {
    return null;
  }
  if (first === 0) return origins[0];
  const preferredOrigins = origins.slice(0, first);
  const deadline = Date.now() + graceMs;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) return origins[first];
    const timeout = delay(left);
    const preferred = await Promise.race([firstReady(preferredOrigins.map(check)).catch(() => null), timeout.promise]);
    timeout.cancel();
    if (preferred !== null) return origins[preferred];
    if (deadline - Date.now() <= recheckMs) return origins[first];
    const pause = delay(recheckMs);
    await pause.promise;
  }
}

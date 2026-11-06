import { omarchyMirror } from "@shared/omarchy";
import type { PreparedOmarchyReport } from "@shared/ingest/omarchy";

// 站点还不展示 Omarchy：只存最新一份，不推送事件、不失效缓存。
export async function commitPreparedOmarchyReport({ presence }: PreparedOmarchyReport) {
  const previous = await omarchyMirror.get();
  if (previous && presence.observedAt <= previous.observedAt) return { changed: false };
  await omarchyMirror.put(presence);
  return { changed: JSON.stringify(previous?.desktop ?? null) !== JSON.stringify(presence.desktop) };
}

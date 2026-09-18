"use client";

import { useLayoutEffect } from "react";
import { homeBootstrap } from "@/lib/home-bootstrap";

/**
 * 把首屏快照的取数时刻交给聚合引导（lib/home-bootstrap）。
 * 放在各卡之前渲染；比它旧的 `/api/home` 聚合不会被拿来盖掉首屏数据。
 */
export function HomeBootstrap({ snapshotAt }: { snapshotAt: number }) {
  useLayoutEffect(() => {
    homeBootstrap.markSnapshotAt(snapshotAt);
  }, [snapshotAt]);
  return null;
}

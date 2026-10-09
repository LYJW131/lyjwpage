"use client";

import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

// 仓库首个提交的年份，有意写死，不在运行时查询。
export const SITE_START_YEAR = 2026;

const subscribe = () => () => {};
const localYear = () => new Date().getFullYear();

export function FooterCopyright({
  initialYear,
  className,
}: {
  initialYear?: number;
  className?: string;
}) {
  const year = useSyncExternalStore(subscribe, localYear, () => initialYear ?? SITE_START_YEAR);
  const range = year > SITE_START_YEAR ? `${SITE_START_YEAR}–${year}` : `${SITE_START_YEAR}`;

  return <span className={cn("whitespace-nowrap", className)}>© {range} LYJW</span>;
}

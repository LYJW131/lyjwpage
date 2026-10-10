// 构建期环境变量必须写完整 process.env 属性访问；解构和动态取键不会被替换。

import { site } from "@/lib/site";

const RAW_COMMIT = process.env.COMMIT_SHA ?? "";
const RAW_BUILD_TIME = process.env.BUILD_TIME ?? "";

export const commitSha = RAW_COMMIT || null;

export const commit = RAW_COMMIT
  ? {
      short: RAW_COMMIT.slice(0, 7),
      url: `${site.repo}/commit/${RAW_COMMIT}`,
    }
  : null;

const FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: site.timezone,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

function formatBuildTime(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return FORMATTER.format(date);
}

export const buildTime = RAW_BUILD_TIME ? formatBuildTime(RAW_BUILD_TIME) : null;

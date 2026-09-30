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

// 固定 h23；en-US 的 hour12:false 会把午夜格式化成 24。
const FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: site.timezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function formatBuildTime(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const parts = Object.fromEntries(
    FORMATTER.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export const buildTime = RAW_BUILD_TIME ? formatBuildTime(RAW_BUILD_TIME) : null;

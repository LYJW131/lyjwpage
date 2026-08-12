/**
 * 页脚那行「什么时候构建的、构建的是哪个提交」。
 *
 * 两个值由 next.config.ts 在构建期算好、内联成字面量，那边写了为什么不能
 * 挪到这里现算。`process.env.X` 必须写成完整字面量 —— 解构或动态取键都替换
 * 不到，会在运行时拿到 undefined。
 */

import { site } from "@/lib/site";

const RAW_COMMIT = process.env.COMMIT_SHA ?? "";
const RAW_BUILD_TIME = process.env.BUILD_TIME ?? "";

/** 拿不到 sha 时是 null，页脚少显示一段，不占位 */
export const commit = RAW_COMMIT
  ? {
      /** 展示只用前 7 位，但链接要完整 sha */
      short: RAW_COMMIT.slice(0, 7),
      url: `${site.repo}/commit/${RAW_COMMIT}`,
    }
  : null;

/**
 * 固定按站点时区格式化，不跟着访客的时区走。
 *
 * 一是这个时刻本来就是「这台机器在那个时区的几点」这种叙述才有意义，二是
 * 值已经是内联的字面量、格式化又是确定性的，客户端组件用它也不会 hydration
 * 对不上。hourCycle 写死 h23：en-US 在 hour12:false 下午夜会给出 24。
 */
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
  // 自己拼而不是用 format()：要的是 YYYY/MM/DD，各 locale 的默认顺序都不是它
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/** 同样拿不到就是 null */
export const buildTime = RAW_BUILD_TIME ? formatBuildTime(RAW_BUILD_TIME) : null;

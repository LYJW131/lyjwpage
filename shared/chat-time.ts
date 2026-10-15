// 注入到模型输入的两份时间：站点时间按站点权威时区渲染，访客时间是浏览器随请求上报的 ISO 瞬间加它自己的时区名（签名外，访客伪造的时钟只影响他自己那次回答）。
// 两份都只进历史最后一条、随该条消息走的可变尾部，不进稳定的 system 前缀；上一轮的值随旧回复留在历史里，新一轮用新值覆盖，缓存断点因此不漂移。
import { site } from "./site";

export type GodChatTimeInput = { iso: string; zone?: string };

const stamp = (zone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const at = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
};

const validZone = (zone: string | undefined) => {
  if (!zone) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
};

// 站点与访客时间渲染同一瞬间：以这条消息带的 iso 为准，iso 缺了才用 now 兜底，
// 否则限流或路由跨过一分钟时两份时间会指向不同时刻。
export function godChatTimeNote(time: GodChatTimeInput | undefined, now: Date = new Date()): string {
  const visitor = time && at(time.iso);
  const moment = visitor ?? now;
  const lines = [`site time (${site.timezone}): ${stamp(site.timezone).format(moment)}`];
  if (visitor) lines.push(`visitor time (${validZone(time.zone)}): ${stamp(validZone(time.zone)).format(visitor)}`);
  return `[Time when this message was sent — ${lines.join("; ")}. Use these for anything time-sensitive instead of asking the visitor.]`;
}

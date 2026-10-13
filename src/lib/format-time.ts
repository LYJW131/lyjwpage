// 服务端（workerd/V8）与 Safari（JSC）的 Intl 在日期与时间之间的连接词不同（", " 对 " at "），
// 服务端渲染的文本一旦不同就触发水合不一致。这里只从 Intl 取数字部分，拼接全部自己做；
// 输出须与 workerd 的 en-US 结果逐字节一致，边缘缓存里的旧 HTML 才能和新客户端对上。

export type WallClock = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function utcWallClock(ms: number): WallClock {
  const at = new Date(ms);
  return {
    year: at.getUTCFullYear(),
    month: at.getUTCMonth() + 1,
    day: at.getUTCDate(),
    weekday: at.getUTCDay(),
    hour: at.getUTCHours(),
    minute: at.getUTCMinutes(),
  };
}

export function localWallClock(ms: number): WallClock {
  const at = new Date(ms);
  return {
    year: at.getFullYear(),
    month: at.getMonth() + 1,
    day: at.getDate(),
    weekday: at.getDay(),
    hour: at.getHours(),
    minute: at.getMinutes(),
  };
}

const zoneParts = new Map<string, Intl.DateTimeFormat>();

export function zonedWallClock(ms: number, timeZone: string): WallClock {
  let format = zoneParts.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    });
    zoneParts.set(timeZone, format);
  }
  const value: Record<string, number> = {};
  for (const part of format.formatToParts(ms)) {
    if (part.type !== "literal") value[part.type] = Number(part.value);
  }
  return utcWallClock(Date.UTC(value.year, value.month - 1, value.day, value.hour % 24, value.minute));
}

const pad2 = (value: number) => String(value).padStart(2, "0");

export function formatMonthDay(at: WallClock): string {
  return `${MONTHS[at.month - 1]} ${at.day}`;
}

export function formatWeekday(at: WallClock): string {
  return WEEKDAYS[at.weekday];
}

export function formatClock12(at: WallClock): string {
  return `${at.hour % 12 || 12}:${pad2(at.minute)} ${at.hour < 12 ? "AM" : "PM"}`;
}

export function formatClock24(at: WallClock): string {
  return `${pad2(at.hour)}:${pad2(at.minute)}`;
}

export function formatDateTime12(at: WallClock): string {
  return `${formatMonthDay(at)}, ${at.year}, ${formatClock12(at)}`;
}

export function formatMonthDayClock12(at: WallClock): string {
  return `${formatMonthDay(at)}, ${formatClock12(at)}`;
}

export function formatMonthDayClock24(at: WallClock): string {
  return `${formatMonthDay(at)}, ${formatClock24(at)}`;
}

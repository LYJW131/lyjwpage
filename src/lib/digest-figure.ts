import type { DigestHighlight } from "@shared/digest";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumSignificantDigits: 2 });

// 数与单位之间一律不留空格，一列里 "22h"、"44M"、"10+" 才排得齐；两位有效数字让宽度封顶在五个字符左右。
export function digestFigure({ value, unit, atLeast }: Pick<DigestHighlight, "value" | "unit" | "atLeast">): string {
  const text = {
    hours: () => `${Math.round(value * 2) / 2}h`,
    minutes: () => `${Math.round(value)}m`,
    count: () => compact.format(value),
  }[unit]();
  return atLeast ? `${text}+` : text;
}

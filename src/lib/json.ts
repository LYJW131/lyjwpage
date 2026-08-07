/**
 * 解析外部 JSON 的公共小工具。
 *
 * 遥测入口和 HomePod 入口收的都是别人发来的 JSON，字段有没有、是什么类型
 * 都不能假设，所以统一走这几个函数把值收敛掉。
 */

export function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** 只认真正的数字。协议里说好是数字的字段用这个，别默默接受字符串。 */
export function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * 数字或数字字符串都收。
 * Home Assistant 的模板渲染出来常常是字符串，那边的字段用这个。
 */
export function numberish(value: unknown) {
  const direct = number(value);
  if (direct != null) return direct;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

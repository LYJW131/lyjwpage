// 内联脚本里的 JSON 须转义小于号，防止数据里的结束标签逃逸出 script 元素。
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

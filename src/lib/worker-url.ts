// 环境变量由调用处完整字面量读取；动态读取不能被客户端构建替换。
export function workerUrl(
  raw: string | undefined,
  path: string,
  { websocket = false }: { websocket?: boolean } = {},
): string | null {
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    console.error("[worker] Worker 地址不是合法 URL：", raw);
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    console.error("[worker] Worker 地址要用 http:// 或 https://：", raw);
    return null;
  }

  const scheme = websocket ? (url.protocol === "https:" ? "wss:" : "ws:") : url.protocol;
  return `${scheme}//${url.host}${path}`;
}

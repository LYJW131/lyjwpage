import { readBoundedBytes } from "../build/http";

// 按读到的字节数截停：缺 Content-Length 的分块请求体也不会先整个读进内存再判断。
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  if (Number(request.headers.get("Content-Length") ?? 0) > maxBytes || !request.body) return null;
  const bytes = await readBoundedBytes(request.body, maxBytes);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

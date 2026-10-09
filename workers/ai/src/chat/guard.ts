import { GOD_CHAT_TURNSTILE_ACTION } from "@shared/god-chat";

import { originMatches } from "@shared/http-origins";

// 按读到的字节数截停：缺 Content-Length 的分块请求体也不会先整个读进内存再判断。
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  if (Number(request.headers.get("Content-Length") ?? 0) > maxBytes || !request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(await new Blob(chunks).text());
  } catch {
    return null;
  }
}

export type SiteverifyResult = {
  success?: boolean;
  hostname?: string;
  action?: string;
  metadata?: { result_with_testing_key?: boolean };
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// siteverify 的 success 只说明 token 是真的，还要核对是不是这张卡片、在本站页面上拿到的。组件的域名列表里有 localhost
// 供本地开发，生产不收 localhost 的 token：否则在自己机器上渲染组件攒下的 token 也能拿来刷生产。
// 本地与预览（dev）放行 localhost；Cloudflare 测试密钥的结果固定是 example.com、不带 action，也只在 dev 认。
export function turnstilePassed(result: SiteverifyResult, allowedOrigins: string[], dev: boolean): boolean {
  if (result.success !== true) return false;
  if (dev && result.metadata?.result_with_testing_key === true) return true;
  if (result.action !== GOD_CHAT_TURNSTILE_ACTION) return false;
  const host = result.hostname ?? "";
  if (dev && LOCAL_HOSTS.has(host)) return true;
  return Boolean(host) && allowedOrigins.some((pattern) => originMatches(`https://${host}`, pattern));
}

export async function verifyTurnstile(secret: string, token: string, ip: string): Promise<SiteverifyResult> {
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(8_000),
    });
    return (await res.json()) as SiteverifyResult;
  } catch {
    return {};
  }
}

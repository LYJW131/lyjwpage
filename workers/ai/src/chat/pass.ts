import { GOD_CHAT_PASS_PATTERN, GOD_CHAT_PASS_TTL_MS } from "@shared/god-chat";
import { base64url, decodeBase64url, hmacKey } from "../crypto";

// 通行证不绑 IP：切 VPN、手机换网都不该重验。挡刷量的是按 IP 的 ChatQuota，通行证只证明这个浏览器验过一次人。
const payload = (expiresAt: number) => new TextEncoder().encode(JSON.stringify(["god-chat-pass-v2", expiresAt]));

export async function issuePass(secret: string, now = Date.now()): Promise<{ pass: string; expiresAt: number }> {
  const expiresAt = now + GOD_CHAT_PASS_TTL_MS;
  const signature = base64url(new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), payload(expiresAt))));
  return { pass: `${expiresAt}.${signature}`, expiresAt };
}

// 只读出声明的到期时间，不验签；调用方须先经 passValid。
export const passExpiresAt = (pass: string | undefined): number => Number(pass?.split(".")[0] ?? 0);

export async function passValid(secret: string, pass: string, now = Date.now()): Promise<boolean> {
  if (!GOD_CHAT_PASS_PATTERN.test(pass)) return false;
  const signature = pass.split(".")[1];
  const expiresAt = passExpiresAt(pass);
  if (!(expiresAt > now) || expiresAt > now + GOD_CHAT_PASS_TTL_MS) return false;
  try {
    return await crypto.subtle.verify("HMAC", await hmacKey(secret), decodeBase64url(signature), payload(expiresAt));
  } catch {
    return false;
  }
}

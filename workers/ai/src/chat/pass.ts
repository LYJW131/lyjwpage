import { GOD_CHAT_PASS_PATTERN, GOD_CHAT_PASS_TTL_MS } from "@shared/god-chat";
import { base64url, decodeBase64url, hmacKey } from "../crypto";

const payload = (expiresAt: number, ip: string) => new TextEncoder().encode(JSON.stringify(["god-chat-pass-v1", expiresAt, ip]));

export async function issuePass(secret: string, ip: string, now = Date.now()): Promise<{ pass: string; expiresAt: number }> {
  const expiresAt = now + GOD_CHAT_PASS_TTL_MS;
  const signature = base64url(new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), payload(expiresAt, ip))));
  return { pass: `${expiresAt}.${signature}`, expiresAt };
}

export async function passValid(secret: string, pass: string, ip: string, now = Date.now()): Promise<boolean> {
  if (!GOD_CHAT_PASS_PATTERN.test(pass)) return false;
  const [expires, signature] = pass.split(".");
  const expiresAt = Number(expires);
  if (!(expiresAt > now) || expiresAt > now + GOD_CHAT_PASS_TTL_MS) return false;
  try {
    return await crypto.subtle.verify("HMAC", await hmacKey(secret), decodeBase64url(signature), payload(expiresAt, ip));
  } catch {
    return false;
  }
}

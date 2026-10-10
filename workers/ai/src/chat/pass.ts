import { GOD_CHAT_PASS_PATTERN, GOD_CHAT_PASS_TTL_MS } from "@shared/god-chat";

const encoder = new TextEncoder();

function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

const payload = (expiresAt: number, ip: string) => encoder.encode(JSON.stringify(["god-chat-pass-v1", expiresAt, ip]));
const toBase64Url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

export async function issuePass(secret: string, ip: string, now = Date.now()): Promise<{ pass: string; expiresAt: number }> {
  const expiresAt = now + GOD_CHAT_PASS_TTL_MS;
  const signature = toBase64Url(await crypto.subtle.sign("HMAC", await key(secret), payload(expiresAt, ip)));
  return { pass: `${expiresAt}.${signature}`, expiresAt };
}

export async function passValid(secret: string, pass: string, ip: string, now = Date.now()): Promise<boolean> {
  if (!GOD_CHAT_PASS_PATTERN.test(pass)) return false;
  const [expires, signature] = pass.split(".");
  const expiresAt = Number(expires);
  if (!(expiresAt > now) || expiresAt > now + GOD_CHAT_PASS_TTL_MS) return false;
  try {
    const bytes = Uint8Array.from(atob(signature.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify("HMAC", await key(secret), bytes, payload(expiresAt, ip));
  } catch {
    return false;
  }
}

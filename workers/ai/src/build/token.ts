import { BUILD_TOKEN_MAX_CHARS } from "@shared/build-routine";

export function base64url(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeBase64url(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
}

export async function hashToken(value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signBuildToken<T>(payload: T, secret: string): Promise<string> {
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(body));
  return `${body}.${base64url(new Uint8Array(signature))}`;
}

export async function verifyBuildToken<T extends { kind: string; expiresAt: number }>(token: string, secret: string, kind: T["kind"], now = Date.now()): Promise<T | null> {
  if (typeof token !== "string" || token.length > BUILD_TOKEN_MAX_CHARS) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    if (!await crypto.subtle.verify("HMAC", await hmacKey(secret), decodeBase64url(parts[1]), new TextEncoder().encode(parts[0]))) return null;
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64url(parts[0]))) as T;
    return payload?.kind === kind && Number.isFinite(payload.expiresAt) && payload.expiresAt > now ? payload : null;
  } catch { return null; }
}

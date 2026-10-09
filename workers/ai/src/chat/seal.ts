import { clipReply, normalizeTrace, type GodChatMessage, type GodChatTrace } from "@shared/god-chat";

// 章只按 Worker 解析过的形态签：浏览器回传前先裁一遍，Worker 收到后去首尾空白再裁一遍，这里照同样的顺序算。
export function storedReply(raw: string): string {
  return clipReply(clipReply(raw).trim());
}

const encoder = new TextEncoder();
let cached: { secret: string; key: Promise<CryptoKey> } | undefined;

function hmacKey(secret: string): Promise<CryptoKey> {
  if (cached?.secret !== secret) {
    cached = {
      secret,
      key: crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]),
    };
  }
  return cached.key;
}

function payload(user: string, assistant: string, trace: GodChatTrace | undefined, planToken?: string): Uint8Array {
  return encoder.encode(JSON.stringify(["god-chat-seal-v2", user, assistant, normalizeTrace(trace) ?? null, planToken ?? null]));
}

const toBase64Url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

function fromBase64Url(value: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

// 一问一答整对签：访客那句是 Clef 放行过的，回复与 trace 是本 Worker 产出的；拼不出别的对话里的章。
export async function sealExchange(secret: string, user: string, assistant: string, trace: GodChatTrace | undefined, planToken?: string): Promise<string> {
  return toBase64Url(await crypto.subtle.sign("HMAC", await hmacKey(secret), payload(user, assistant, trace, planToken)));
}

async function sealValid(secret: string, user: GodChatMessage, assistant: GodChatMessage): Promise<boolean> {
  const signature = assistant.seal ? fromBase64Url(assistant.seal) : null;
  if (!signature) return false;
  return crypto.subtle.verify("HMAC", await hmacKey(secret), signature, payload(user.content, assistant.content, assistant.trace, assistant.planToken));
}

// 历史由浏览器提交：没盖章或章对不上的一问一答整对丢掉（Clef 拒掉的、伪造的、半路中断的都在此列），最后一条是这次的新消息。
export async function sealedHistory(messages: GodChatMessage[], secret: string): Promise<GodChatMessage[]> {
  const latest = messages[messages.length - 1];
  const kept: GodChatMessage[] = [];
  for (let i = 0; i < messages.length - 1; ) {
    const user = messages[i];
    const assistant = messages[i + 1];
    if (user.role === "user" && assistant?.role === "assistant" && i + 1 < messages.length - 1 && (await sealValid(secret, user, assistant))) {
      kept.push(user, assistant);
      i += 2;
    } else i += 1;
  }
  return [...kept, latest];
}

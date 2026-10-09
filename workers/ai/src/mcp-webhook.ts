import { timingSafeEqual } from "node:crypto";

export const WEBHOOK_TIMEOUT_MS = 10_000;
export const WEBHOOK_RESPONSE_LIMIT = 4_096;
export const WEBHOOK_PAYLOAD_LIMIT = 262_144;
const RESPONSE_HEADER_LIMIT = 8_192;
const RESPONSE_WIRE_LIMIT = 32_768;
const DNS_RESPONSE_LIMIT = 16_384;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

export type WebhookErrorReason =
  | "invalid_url" | "host_not_allowed" | "invalid_secret" | "address_not_public"
  | "dns_failed" | "connection_failed" | "timeout" | "redirect" | "invalid_response"
  | "response_too_large" | "payload_too_large" | "challenge_failed";

export class WebhookError extends Error {
  readonly reason: WebhookErrorReason;

  constructor(reason: WebhookErrorReason) {
    super(`Webhook ${reason}`);
    this.name = "WebhookError";
    this.reason = reason;
  }
}

function callbackUrl(value: string): URL {
  try {
    if (value.length > 2_048 || /[\s\\]/u.test(value) || value.includes("#") || !/^https:\/\//iu.test(value)) throw new Error();
    if (/^https:\/\/[^/?]*@/iu.test(value)) throw new Error();
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error();
    if (url.hostname.length > 253 || !url.hostname.includes(".") || /^\d+(?:\.\d+)*$/u.test(url.hostname)) throw new Error();
    if (!url.hostname.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))) throw new Error();
    if (/\.(?:localhost|local|internal|home|lan|test|invalid)$/u.test(url.hostname)) throw new Error();
    return url;
  } catch {
    throw new WebhookError("invalid_url");
  }
}

export function validateCallbackUrl(value: string, allowedHosts: string | readonly string[]): string {
  const url = callbackUrl(value);
  const hosts = typeof allowedHosts === "string" ? allowedHosts.split(",") : allowedHosts;
  if (!hosts.some((host) => host.trim().toLowerCase() === url.hostname)) throw new WebhookError("host_not_allowed");
  return url.href;
}

export function normalizeCallbackUrl(value: string): string {
  return callbackUrl(value).href;
}

export function validateSigningSecret(secret: string): Uint8Array<ArrayBuffer> {
  if (!/^whsec_(?:[A-Za-z0-9+/]{4}){8,21}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(secret)) {
    throw new WebhookError("invalid_secret");
  }
  const encoded = secret.slice(6);
  const decoded = atob(encoded);
  if (decoded.length < 24 || decoded.length > 64 || btoa(decoded) !== encoded) throw new WebhookError("invalid_secret");
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export async function signWebhook(secret: string, id: string, timestamp: number, body: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{1,200}$/u.test(id) || !Number.isSafeInteger(timestamp) || timestamp < 0) throw new WebhookError("invalid_response");
  const key = await crypto.subtle.importKey("raw", validateSigningSecret(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${id}.${timestamp}.${body}`));
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

function ipv4(address: string): number[] | null {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/u.test(address)) return null;
  const parts = address.split(".").map(Number);
  return parts.every((part) => part <= 255) ? parts : null;
}

function ipv6(address: string): number[] | null {
  if (!/^[\da-f:]+$/iu.test(address)) return null;
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  if (![...left, ...right].every((part) => /^[\da-f]{1,4}$/iu.test(part))) return null;
  if (halves.length === 1 && left.length !== 8) return null;
  if (halves.length === 2 && left.length + right.length >= 8) return null;
  return [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right].map((part) => parseInt(part, 16));
}

export function isPublicAddress(address: string): boolean {
  const v4 = ipv4(address);
  if (v4) {
    const [a, b, c] = v4;
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  const v6 = ipv6(address);
  if (!v6) return false;
  const [a, b] = v6;
  return a >= 0x2000 && a <= 0x3fff
    && !(a === 0x2001 && (b < 0x200 || b === 0xdb8))
    && a !== 0x2002
    && !(a === 0x3fff && b < 0x1000);
}

export type WebhookResponse = { status: number; body: string };
export type WebhookPost = (url: string, headers: Record<string, string>, body: string) => Promise<WebhookResponse>;
export type WebhookSocket = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened: Promise<unknown>;
  closed: Promise<void>;
  close(): Promise<void>;
  startTls(options: { expectedServerHostname: string }): WebhookSocket;
};
export type WebhookNetwork = {
  resolve(hostname: string, signal: AbortSignal): Promise<string[]>;
  connect(address: { hostname: string; port: number }, options: { secureTransport: "starttls"; allowHalfOpen: false }): WebhookSocket | Promise<WebhookSocket>;
};

class ResponseReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private pending: Uint8Array<ArrayBufferLike> = new Uint8Array();
  private total = 0;
  private overflow = false;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  async pull(): Promise<boolean> {
    if (this.overflow) throw new WebhookError("response_too_large");
    const result = await this.reader.read();
    if (result.done) return false;
    const retained = result.value.subarray(0, RESPONSE_WIRE_LIMIT - this.total);
    this.overflow = retained.byteLength < result.value.byteLength;
    this.total += retained.byteLength;
    const buffer = new Uint8Array(this.pending.byteLength + retained.byteLength);
    buffer.set(this.pending);
    buffer.set(retained, this.pending.byteLength);
    this.pending = buffer;
    return true;
  }

  async line(limit: number): Promise<string> {
    while (true) {
      const index = this.pending.findIndex((byte, i) => byte === 13 && this.pending[i + 1] === 10);
      if (index >= 0) {
        if (index > limit) throw new WebhookError("response_too_large");
        const line = decoder.decode(this.pending.subarray(0, index));
        this.pending = this.pending.subarray(index + 2);
        return line;
      }
      if (this.pending.byteLength > limit + 1) throw new WebhookError("response_too_large");
      if (!await this.pull()) throw new WebhookError("invalid_response");
    }
  }

  async bytes(length: number): Promise<Uint8Array> {
    while (this.pending.byteLength < length) {
      if (!await this.pull()) throw new WebhookError("invalid_response");
    }
    const bytes = this.pending.slice(0, length);
    this.pending = this.pending.subarray(length);
    return bytes;
  }

  async remaining(): Promise<Uint8Array> {
    while (true) {
      if (this.pending.byteLength > WEBHOOK_RESPONSE_LIMIT) throw new WebhookError("response_too_large");
      if (!await this.pull()) return this.pending;
    }
  }

  release(): void {
    this.reader.releaseLock();
  }
}

async function readResponse(stream: ReadableStream<Uint8Array>): Promise<WebhookResponse> {
  const reader = new ResponseReader(stream);
  let headerBytes = 0;
  const line = async () => {
    const value = await reader.line(RESPONSE_HEADER_LIMIT);
    headerBytes += encoder.encode(value).byteLength + 2;
    if (headerBytes > RESPONSE_HEADER_LIMIT) throw new WebhookError("response_too_large");
    return value;
  };
  try {
    let status = 0;
    let headers = new Map<string, string>();
    for (let interim = 0; interim <= 3; interim++) {
      const match = /^HTTP\/1\.[01] ([1-5]\d\d)(?: [\x20-\x7e]*)?$/u.exec(await line());
      if (!match) throw new WebhookError("invalid_response");
      status = Number(match[1]);
      headers = new Map();
      for (let value = await line(); value; value = await line()) {
        const header = /^([!#$%&'*+.^_`|~\da-z-]+):[\t ]*([^\x00-\x08\x0a-\x1f\x7f]*)$/iu.exec(value);
        if (!header) throw new WebhookError("invalid_response");
        const name = header[1].toLowerCase();
        if (headers.has(name) && ["content-length", "transfer-encoding", "content-encoding"].includes(name)) throw new WebhookError("invalid_response");
        headers.set(name, header[2].trim());
      }
      if (status >= 200) break;
      if (status === 101 || interim === 3) throw new WebhookError("invalid_response");
    }
    if (status >= 300 && status < 400) throw new WebhookError("redirect");
    if (status === 410 || status === 413) return { status, body: "" };
    const length = headers.get("content-length");
    const transfer = headers.get("transfer-encoding");
    const encoding = headers.get("content-encoding");
    if ((transfer && length) || (encoding && encoding !== "identity")) throw new WebhookError("invalid_response");
    if (status === 204 || status === 205) return { status, body: "" };
    if (transfer) {
      if (transfer.toLowerCase() !== "chunked") throw new WebhookError("invalid_response");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunkLine = await reader.line(256);
        if (!/^[\da-f]+(?:;[\x20-\x7e]*)?$/iu.test(chunkLine)) throw new WebhookError("invalid_response");
        const chunkSize = parseInt(chunkLine, 16);
        if (!Number.isSafeInteger(chunkSize) || size + chunkSize > WEBHOOK_RESPONSE_LIMIT) throw new WebhookError("response_too_large");
        if (chunkSize === 0) {
          for (let trailer = await line(); trailer; trailer = await line()) {
            if (!/^[!#$%&'*+.^_`|~\da-z-]+:[\t\x20-\x7e]*$/iu.test(trailer)) throw new WebhookError("invalid_response");
          }
          break;
        }
        chunks.push(await reader.bytes(chunkSize));
        size += chunkSize;
        if (await reader.line(0) !== "") throw new WebhookError("invalid_response");
      }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { status, body: decoder.decode(body) };
    }
    if (length !== undefined) {
      if (!/^\d+$/u.test(length)) throw new WebhookError("invalid_response");
      const size = Number(length);
      if (!Number.isSafeInteger(size) || size > WEBHOOK_RESPONSE_LIMIT) throw new WebhookError("response_too_large");
      return { status, body: decoder.decode(await reader.bytes(size)) };
    }
    return { status, body: decoder.decode(await reader.remaining()) };
  } finally {
    reader.release();
  }
}

function requestBytes(url: URL, headers: Record<string, string>, body: string): Uint8Array {
  const bytes = encoder.encode(body);
  if (bytes.byteLength > WEBHOOK_PAYLOAD_LIMIT) throw new WebhookError("payload_too_large");
  const allowed = new Set(["content-type", "webhook-id", "webhook-timestamp", "webhook-signature", "x-mcp-subscription-id"]);
  const normalized = new Map<string, string>();
  for (const [name, value] of Object.entries(headers)) {
    if (!allowed.has(name.toLowerCase()) || !/^[\x20-\x7e]{1,512}$/u.test(value) || normalized.has(name.toLowerCase())) throw new WebhookError("invalid_response");
    normalized.set(name.toLowerCase(), value);
  }
  normalized.set("content-type", "application/json");
  const head = encoder.encode(`POST ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.hostname}\r\nConnection: close\r\nAccept-Encoding: identity\r\nContent-Length: ${bytes.byteLength}\r\n${[...normalized].map(([name, value]) => `${name}: ${value}\r\n`).join("")}\r\n`);
  const request = new Uint8Array(head.byteLength + bytes.byteLength);
  request.set(head);
  request.set(bytes, head.byteLength);
  return request;
}

export function createWebhookPost(network: WebhookNetwork, timeoutMs = WEBHOOK_TIMEOUT_MS): WebhookPost {
  return async (value, headers, body) => {
    const url = callbackUrl(value);
    const bytes = requestBytes(url, headers, body);
    const controller = new AbortController();
    let socket: WebhookSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const close = () => { void socket?.close().catch(() => undefined); };
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        close();
        reject(new WebhookError("timeout"));
      }, timeoutMs);
    });
    const run = async (): Promise<WebhookResponse> => {
      const addresses = await network.resolve(url.hostname, controller.signal);
      if (controller.signal.aborted) throw new WebhookError("timeout");
      if (!addresses.length || addresses.length > 32) throw new WebhookError("dns_failed");
      if (!addresses.every(isPublicAddress)) throw new WebhookError("address_not_public");
      socket = await network.connect({ hostname: addresses[0], port: 443 }, { secureTransport: "starttls", allowHalfOpen: false });
      void socket.closed.catch(() => undefined);
      void socket.opened.catch(() => undefined);
      if (controller.signal.aborted) { close(); throw new WebhookError("timeout"); }
      await socket.opened;
      if (controller.signal.aborted) throw new WebhookError("timeout");
      socket = socket.startTls({ expectedServerHostname: url.hostname });
      void socket.closed.catch(() => undefined);
      await socket.opened;
      if (controller.signal.aborted) throw new WebhookError("timeout");
      const writer = socket.writable.getWriter();
      try { await writer.write(bytes); } finally { writer.releaseLock(); }
      if (controller.signal.aborted) throw new WebhookError("timeout");
      return await readResponse(socket.readable);
    };
    try {
      return await Promise.race([run(), deadline]);
    } catch (error) {
      if (error instanceof WebhookError) throw error;
      throw new WebhookError("connection_failed");
    } finally {
      clearTimeout(timer);
      controller.abort();
      close();
    }
  };
}

export async function resolveWebhookAddresses(hostname: string, signal: AbortSignal): Promise<string[]> {
  try {
    const results = await Promise.all(["A", "AAAA"].map(async (type) => {
      const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`, {
        headers: { Accept: "application/dns-json" }, redirect: "error", signal,
      });
      if (!response.ok || !response.body) throw new Error();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > DNS_RESPONSE_LIMIT) throw new Error();
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      const buffer = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
      const data = JSON.parse(decoder.decode(buffer)) as { Status?: unknown; TC?: unknown; Answer?: { type?: unknown; data?: unknown }[] };
      if (data.Status !== 0 || data.TC !== false || (data.Answer !== undefined && !Array.isArray(data.Answer))) throw new Error();
      return (data.Answer ?? []).filter((answer) => answer.type === 1 || answer.type === 28).map((answer) => {
        if (typeof answer.data !== "string") throw new Error();
        return answer.data;
      });
    }));
    return [...new Set(results.flat())];
  } catch {
    throw new WebhookError(signal.aborted ? "timeout" : "dns_failed");
  }
}

export const webhookPost: WebhookPost = createWebhookPost({
  resolve: resolveWebhookAddresses,
  connect: async (address, options) => {
    const { connect } = await import("cloudflare:sockets");
    return connect(address, options);
  },
});

export async function verifyCallback(
  url: string,
  secret: string,
  subscriptionId: string,
  options: { post?: WebhookPost; now?: () => number } = {},
): Promise<void> {
  const challenge = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const body = JSON.stringify({ type: "verification", challenge });
  const id = `msg_verification_${crypto.randomUUID()}`;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const timestamp = Math.floor(startedAt / 1_000);
  const response = await (options.post ?? webhookPost)(url, {
    "Content-Type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": await signWebhook(secret, id, timestamp, body),
    "X-MCP-Subscription-Id": subscriptionId,
  }, body);
  if (now() - startedAt > WEBHOOK_TIMEOUT_MS) throw new WebhookError("timeout");
  if (response.status < 200 || response.status >= 300) throw new WebhookError("challenge_failed");
  try {
    const value = JSON.parse(response.body) as { challenge?: unknown } | null;
    if (typeof value?.challenge !== "string" || !constantTimeEqual(challenge, value.challenge)) throw new Error();
  } catch {
    throw new WebhookError("challenge_failed");
  }
}

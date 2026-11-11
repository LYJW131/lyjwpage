import { STORAGE_MAX_BYTES } from "@shared/storage-contract";

export async function readBoundedBytes(stream: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > STORAGE_MAX_BYTES) { await reader.cancel(); throw new Error("Body too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export async function readBoundedBody(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  return new TextDecoder().decode(await readBoundedBytes(stream));
}

export function decompressedBody(request: Request): ReadableStream<Uint8Array> | null {
  const encoding = request.headers.get("Content-Encoding")?.trim().toLowerCase();
  if (encoding && encoding !== "identity" && encoding !== "gzip") throw new UnsupportedEncoding(`不支持的压缩：${encoding}`);
  return encoding === "gzip" && request.body ? request.body.pipeThrough(new DecompressionStream("gzip")) : request.body;
}

export class UnsupportedEncoding extends Error {}

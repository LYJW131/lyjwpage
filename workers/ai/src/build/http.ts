import type { Env } from "../runtime";
import type { BuildCoordinator } from "./coordinator";

export const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function fail(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export function bearerToken(request: Request): string | undefined {
  return /^Bearer ([A-Za-z0-9_.-]+)$/.exec(request.headers.get("Authorization") ?? "")?.[1];
}

export function buildCoordinator(env: Env): DurableObjectStub<BuildCoordinator> {
  return env.BUILD_COORDINATOR!.getByName("global");
}

export async function readBoundedBytes(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Uint8Array | null> {
  const reader = body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  try {
    const bytes = await readBoundedBytes(response.body, maxBytes);
    return bytes && JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}

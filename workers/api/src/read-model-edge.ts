import { readModelKey, readModelPolicy, usableReadModel, type ReadModelKv } from "./read-model.ts";

export type ReadModelReader = {
  kv?: ReadModelKv;
  prefix: string;
  enabled: boolean;
  allowedOrigin: boolean;
  cors: Headers;
  origin: () => Promise<Response>;
  refresh: (path: string) => void;
  now?: () => number;
  timeoutMs?: number;
};

async function boundedRead(kv: ReadModelKv, key: string, timeoutMs: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      kv.get(key, { type: "json", cacheTtl: 60 }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("KV read timeout")), timeoutMs); }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Cache hits never enter StateHub. Misses never publish from a distributed reader. */
export async function serveReadModel(request: Request, reader: ReadModelReader): Promise<Response> {
  const url = new URL(request.url);
  // Query-dependent responses (since, titleids, other search params) retain their original semantics.
  if (!reader.enabled || !reader.kv || !reader.allowedOrigin || request.method !== "GET" ||
      url.search !== "" || !readModelPolicy(url.pathname)) return reader.origin();

  try {
    const value = await boundedRead(reader.kv, readModelKey(reader.prefix, url.pathname), reader.timeoutMs ?? 1_000);
    if (usableReadModel(value, url.pathname, (reader.now ?? Date.now)())) {
      // Never persist or replay a previous visitor's CORS headers.
      const headers = new Headers(reader.cors);
      headers.set("Content-Type", "application/json; charset=utf-8");
      headers.set("Cache-Control", "no-store");
      headers.set("X-Fetched-At", new Date(value.generatedAt).toISOString());
      headers.set("X-Read-Model", "kv");
      headers.set("X-Read-Model-Revision", String(value.revision));
      headers.set("Access-Control-Expose-Headers", "X-Fetched-At, X-Read-Model, X-Read-Model-Revision");
      return new Response(value.body, { headers });
    }
  } catch {
    // KV unavailability must not break a healthy authoritative read.
  }

  const response = await reader.origin();
  if (response.ok) reader.refresh(url.pathname);
  const headers = new Headers(response.headers);
  headers.set("X-Read-Model", "origin");
  headers.set("Access-Control-Expose-Headers", "X-Fetched-At, X-Read-Model, X-Read-Model-Revision");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

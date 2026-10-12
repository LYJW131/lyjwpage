import { BodyTooLargeError, readBoundedBytes } from "@shared/read-bounded-bytes";

export const SENTRY_RELAY_MAX_BYTES = 1_048_576;
const SENTRY_RELAY_TIMEOUT_MS = 8_000;

function dsnProjectId(dsn: URL): string | null {
  const match = /^\/(\d+)$/.exec(dsn.pathname);
  return match ? match[1] : null;
}

export function sentryRelayTarget(envelopeDsn: string | null, allowedDsn: string): string | null {
  if (!envelopeDsn) return null;
  let envelope: URL;
  let allowed: URL;
  try {
    envelope = new URL(envelopeDsn);
    allowed = new URL(allowedDsn);
  } catch {
    return null;
  }
  if (envelope.protocol !== "https:" || allowed.protocol !== "https:") return null;
  if (envelope.host !== allowed.host) return null;
  if (envelope.username !== allowed.username) return null;
  if (envelope.password || envelope.search || envelope.hash) return null;
  const projectId = dsnProjectId(allowed);
  if (projectId === null || dsnProjectId(envelope) !== projectId) return null;
  return `https://${allowed.host}/api/${projectId}/envelope/`;
}

export function envelopeDsn(body: Uint8Array): string | null {
  const end = body.indexOf(0x0a);
  const header = new TextDecoder().decode(body.subarray(0, end === -1 ? undefined : end));
  try {
    const parsed = JSON.parse(header) as { dsn?: unknown };
    return typeof parsed.dsn === "string" ? parsed.dsn : null;
  } catch {
    return null;
  }
}

export type RelayResult =
  | { response: Response }
  | { reject: number };

export async function relaySentryEnvelope(
  request: Request,
  allowedDsn: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<RelayResult> {
  const allowed = allowedDsn?.trim();
  if (!allowed) return { reject: 404 };
  let body: Uint8Array<ArrayBuffer>;
  try {
    body = await readBoundedBytes(request.body, SENTRY_RELAY_MAX_BYTES);
  } catch (error) {
    return { reject: error instanceof BodyTooLargeError ? 413 : 400 };
  }
  const target = sentryRelayTarget(envelopeDsn(body), allowed);
  if (!target) return { reject: 403 };
  let response: Response;
  try {
    response = await fetcher(target, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body,
      // Workers 的 fetch 不支持 redirect: "error"，会同步抛 TypeError；只能 manual 后自己拒掉 3xx。
      redirect: "manual",
      signal: AbortSignal.timeout(SENTRY_RELAY_TIMEOUT_MS),
    });
  } catch {
    return { reject: 504 };
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    return { reject: 502 };
  }
  return { response };
}

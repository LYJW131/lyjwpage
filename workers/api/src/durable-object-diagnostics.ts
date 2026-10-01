import type { CloudflareOptions } from "@sentry/cloudflare";

export type DurableObjectClass = "LivePushRoom" | "StateHub";
export type LivePushMethod = "fetch" | "alarm" | "webSocketMessage" | "webSocketClose" | "webSocketError" | "audience";
type FailureContext = {
  class: DurableObjectClass;
  method: LivePushMethod;
  storage_operation?: "getAlarm" | "setAlarm";
};
type ErrorEvent = Parameters<NonNullable<CloudflareOptions["beforeSend"]>>[0];
const failures = new WeakMap<object, FailureContext>();

function objectLike(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function errorFlag(error: unknown, name: "retryable" | "overloaded" | "remote"): boolean | undefined {
  if (!objectLike(error)) return undefined;
  try {
    for (let value: object | null = error, depth = 0; value && depth < 8; value = Object.getPrototypeOf(value), depth += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (descriptor) return typeof descriptor.value === "boolean" ? descriptor.value : undefined;
    }
  } catch {}
  return undefined;
}

function rememberFailure(error: unknown, context: FailureContext): void {
  if (objectLike(error)) failures.set(error, { ...context, ...failures.get(error) });
}

export async function observeDurableObject<T>(context: FailureContext, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    rememberFailure(error, context);
    throw error;
  }
}

export function captureBackgroundFailure(work: Promise<void>, capture: (error: unknown) => void): Promise<void> {
  return work.catch((error: unknown) => {
    try {
      capture(error);
    } catch {}
    throw error;
  });
}

export function enrichDurableObjectEvent(event: ErrorEvent, error: unknown, className?: DurableObjectClass): ErrorEvent {
  const failure = objectLike(error) ? failures.get(error) : undefined;
  const retryable = errorFlag(error, "retryable");
  const overloaded = errorFlag(error, "overloaded");
  const remote = errorFlag(error, "remote");
  if (!failure && !className && retryable === undefined && overloaded === undefined && remote === undefined) return event;
  const context = {
    ...(className ? { class: className } : {}),
    ...failure,
    ...(retryable === undefined ? {} : { retryable }),
    ...(overloaded === undefined ? {} : { overloaded }),
    ...(remote === undefined ? {} : { remote }),
  };
  return {
    ...event,
    contexts: { ...event.contexts, durable_object: context },
    tags: { ...event.tags, ...Object.fromEntries(Object.entries(context).map(([key, value]) => [`do.${key}`, String(value)])) },
  };
}

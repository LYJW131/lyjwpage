import { STATUS_VIEWS } from "@/lib/status-views";

export const EVENT_NAME = "watching-now";
export const WATCHING_STATUS_PATH = STATUS_VIEWS.nowWatching.path;
export const WATCHING_CHANGES = ["started", "changed", "paused", "resumed", "stopped"] as const;

export type WatchingChange = (typeof WATCHING_CHANGES)[number];
export type EventArguments = { change?: WatchingChange };
export type WatchingSnapshot = {
  itemId: string | null;
  title: string | null;
  paused: boolean | null;
};
export type WatchingEventPayload = WatchingSnapshot & {
  change: WatchingChange;
  detectedAt: number;
  sequence: number;
};

const MAX_ITEM_ID_CHARS = 1024;
const MAX_TITLE_CHARS = 2048;

export const EVENT_DEFINITIONS = [{
  name: EVENT_NAME,
  description: "A sampled change to LYJW's public Emby playback: started, changed item, paused, resumed, or stopped. Periodic sampling runs only while subscriptions are active; short-lived changes between samples can be missed. Progress and metadata updates do not trigger events. No replay. Read the current public state with get_site_status using views: [nowWatching].",
  delivery: ["webhook"],
  inputSchema: {
    type: "object",
    properties: {
      change: { type: "string", enum: WATCHING_CHANGES, description: "Only deliver this kind of playback change. Omit to receive all kinds." },
    },
    additionalProperties: false,
  },
  payloadSchema: {
    type: "object",
    properties: {
      change: { type: "string", enum: WATCHING_CHANGES },
      detectedAt: { type: "integer", minimum: 0, description: "Time this sampled change was detected, in Unix milliseconds; not the source playback time." },
      sequence: { type: "integer", minimum: 1, description: "Increasing detected-change sequence. Gaps are possible because of filters or delivery limits." },
      itemId: { type: ["string", "null"], maxLength: MAX_ITEM_ID_CHARS },
      title: { type: ["string", "null"], maxLength: MAX_TITLE_CHARS },
      paused: { type: ["boolean", "null"] },
    },
    required: ["change", "detectedAt", "sequence", "itemId", "title", "paused"],
    additionalProperties: false,
  },
}];

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function itemId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_ITEM_ID_CHARS;
}

export function parseEventArguments(value: unknown): EventArguments {
  if (value === undefined) return {};
  if (!object(value) || Object.keys(value).some((key) => key !== "change")) {
    throw new Error("Event arguments must be an object containing only change");
  }
  if (!Object.hasOwn(value, "change")) return {};
  if (typeof value.change !== "string" || !WATCHING_CHANGES.includes(value.change as WatchingChange)) {
    throw new Error("Unknown watching change");
  }
  return { change: value.change as WatchingChange };
}

export function readWatchingSnapshot(value: unknown): WatchingSnapshot {
  if (!object(value) || value.ok !== true || !object(value.data) || !Object.hasOwn(value.data, "nowPlaying")) {
    throw new Error("Invalid public watching response");
  }
  const { nowPlaying, current } = value.data;
  if (nowPlaying === null) return { itemId: null, title: null, paused: null };
  if (!object(nowPlaying) || !itemId(nowPlaying.itemId) || typeof nowPlaying.paused !== "boolean") {
    throw new Error("Invalid public watching playback");
  }
  if (current !== null && (!object(current) || current.id !== nowPlaying.itemId || typeof current.title !== "string" || current.title.length > MAX_TITLE_CHARS)) {
    throw new Error("Invalid public watching item");
  }
  return {
    itemId: nowPlaying.itemId,
    title: current === null ? null : current.title as string,
    paused: nowPlaying.paused,
  };
}

export function snapshotKey(snapshot: WatchingSnapshot): string {
  return JSON.stringify([snapshot.itemId, snapshot.paused]);
}

export function detectWatchingChange(
  previous: WatchingSnapshot,
  next: WatchingSnapshot,
  detectedAt: number,
  sequence: number,
): WatchingEventPayload | null {
  if (snapshotKey(previous) === snapshotKey(next)) return null;
  if (!Number.isSafeInteger(detectedAt) || detectedAt < 0 || !Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("Invalid watching event clock or sequence");
  }
  const change: WatchingChange = next.itemId === null ? "stopped"
    : previous.itemId === null ? "started"
      : next.itemId !== previous.itemId ? "changed"
        : next.paused ? "paused" : "resumed";
  return { ...next, change, detectedAt, sequence };
}

export function matchesEventArguments(args: EventArguments, payload: WatchingEventPayload): boolean {
  return args.change === undefined || args.change === payload.change;
}

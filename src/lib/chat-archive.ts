import type { BuildFireResult, BuildProposal, BuildRun } from "@shared/build-routine";
import type { GodChatCard, GodChatMessage, GodChatSource } from "@shared/god-chat";
import type { GodChatTier } from "@shared/god-chat-tiers";
import type { GithubIssueResult } from "@shared/github-issue";

export const CHAT_ARCHIVE_KEY = "lyjw.chat.v1";
export const CHAT_ARCHIVE_LIMITS = { sessions: 20, bytes: 2 * 1024 * 1024 } as const;
export type ChatDesign = { token: string; expiresAt: number; remaining: number };
export type ChatProposal = BuildProposal & { issue?: GithubIssueResult; build?: BuildFireResult; run?: BuildRun };
export type ChatBubble = GodChatMessage & {
  tier?: GodChatTier | null;
  downgradedFrom?: GodChatTier;
  servedBy?: string;
  thinking?: string;
  lookups?: string[];
  docs?: { doc: string; path: string; url: string; section?: string }[];
  searches?: string[];
  sources?: GodChatSource[];
  cards?: { card: GodChatCard; at: number }[];
  proposals?: ChatProposal[];
};
export type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatBubble[];
  design?: ChatDesign;
};
export type ChatArchive = { version: 1; activeId: string; sessions: ChatSession[] };
export const EMPTY_CHAT_ARCHIVE: ChatArchive = { version: 1, activeId: "", sessions: [] };
type ArchiveStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const optionalString = (value: unknown) => value === undefined || typeof value === "string";

function validRun(value: unknown): boolean {
  if (!object(value) || typeof value.runId !== "string" || typeof value.branch !== "string" || !["triggered", "running", "uploaded", "validated", "blocked", "pr_open", "merged", "closed", "timeout", "failed"].includes(String(value.phase))) return false;
  if (!optionalString(value.reason) || !optionalString(value.progress)) return false;
  if (value.pr !== undefined && (!object(value.pr) || typeof value.pr.number !== "number" || typeof value.pr.url !== "string" || typeof value.pr.headSha !== "string")) return false;
  return ["ci", "preview", "review"].every((key) => value[key] === undefined || (object(value[key]) && typeof value[key].state === "string" && optionalString(value[key].url)));
}

function validBubble(value: unknown): value is ChatBubble {
  if (!object(value) || !["user", "assistant"].includes(String(value.role)) || typeof value.content !== "string") return false;
  if (value.cards !== undefined && (!Array.isArray(value.cards) || !value.cards.every((card) => object(card) && ["music", "watching", "gaming", "fitness"].includes(String(card.card)) && typeof card.at === "number"))) return false;
  if (value.proposals !== undefined && (!Array.isArray(value.proposals) || !value.proposals.every((proposal) => {
    if (!object(proposal) || typeof proposal.token !== "string" || typeof proposal.expiresAt !== "number" || !object(proposal.plan)) return false;
    const plan = proposal.plan;
    if (typeof plan.title !== "string" || typeof plan.spec !== "string" || !strings(plan.acceptance) || !strings(plan.paths)) return false;
    if (proposal.issue && (!object(proposal.issue) || typeof proposal.issue.url !== "string" || typeof proposal.issue.number !== "number")) return false;
    if (proposal.build && (!object(proposal.build) || typeof proposal.build.runId !== "string" || typeof proposal.build.statusToken !== "string" || typeof proposal.build.branch !== "string")) return false;
    return proposal.run === undefined || validRun(proposal.run);
  }))) return false;
  if (["lookups", "searches"].some((key) => value[key] !== undefined && !strings(value[key]))) return false;
  if (value.docs !== undefined && (!Array.isArray(value.docs) || !value.docs.every((doc) => object(doc) && typeof doc.path === "string" && typeof doc.url === "string" && optionalString(doc.section)))) return false;
  if (value.sources !== undefined && (!Array.isArray(value.sources) || !value.sources.every((source) => object(source) && typeof source.url === "string" && typeof source.title === "string"))) return false;
  return ["thinking", "seal", "planToken", "servedBy"].every((key) => optionalString(value[key])) && (value.tier === undefined || value.tier === null || ["haiku", "opus", "fable"].includes(String(value.tier))) && (value.downgradedFrom === undefined || ["haiku", "opus", "fable"].includes(String(value.downgradedFrom)));
}

export function readChatArchive(raw: string | null): ChatArchive {
  if (!raw || byteLength(raw) > CHAT_ARCHIVE_LIMITS.bytes) return EMPTY_CHAT_ARCHIVE;
  try {
    const value: unknown = JSON.parse(raw);
    if (!object(value) || value.version !== 1 || !Array.isArray(value.sessions)) return EMPTY_CHAT_ARCHIVE;
    const ids = new Set<string>();
    const sessions = value.sessions.filter((session): session is ChatSession => {
      if (!object(session) || typeof session.id !== "string" || !session.id || ids.has(session.id) || typeof session.title !== "string" || typeof session.createdAt !== "number" || !Number.isFinite(session.createdAt) || typeof session.updatedAt !== "number" || !Number.isFinite(session.updatedAt) || Math.abs(session.updatedAt) > 8.64e15 || !Array.isArray(session.messages) || !session.messages.every(validBubble)) return false;
      if (session.design && (!object(session.design) || typeof session.design.token !== "string" || typeof session.design.expiresAt !== "number" || typeof session.design.remaining !== "number")) return false;
      ids.add(session.id);
      return true;
    });
    return boundChatArchive({ version: 1, activeId: typeof value.activeId === "string" ? value.activeId : "", sessions });
  } catch {
    return EMPTY_CHAT_ARCHIVE;
  }
}

export function boundChatArchive(archive: ChatArchive): ChatArchive {
  const sessions = [...archive.sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, CHAT_ARCHIVE_LIMITS.sessions);
  const result: ChatArchive = { ...archive, sessions };
  while (sessions.length && byteLength(JSON.stringify(result)) > CHAT_ARCHIVE_LIMITS.bytes) {
    if (sessions.length > 1) sessions.pop();
    else {
      const session = sessions[0];
      if (!session.messages.length) { sessions.pop(); break; }
      let messages = session.messages.slice(1);
      while (messages[0]?.role === "assistant") messages = messages.slice(1);
      sessions[0] = { ...session, messages };
    }
  }
  if (!sessions.some((session) => session.id === result.activeId)) result.activeId = sessions[0]?.id ?? "";
  return result;
}

export function createChatArchiveStore(storage: () => ArchiveStorage | null, newId = () => crypto.randomUUID(), now = () => Date.now()) {
  let archive: ChatArchive | undefined;
  let memoryOnly = false;
  const listeners = new Set<() => void>();
  const snapshot = () => {
    if (!archive) {
      try { archive = readChatArchive(storage()?.getItem(CHAT_ARCHIVE_KEY) ?? null); }
      catch { archive = EMPTY_CHAT_ARCHIVE; memoryOnly = true; }
      if (!archive.sessions.length) {
        const time = now();
        const id = newId();
        archive = { version: 1, activeId: id, sessions: [{ id, title: "New conversation", createdAt: time, updatedAt: time, messages: [] }] };
      }
    }
    return archive;
  };
  const save = (next: ChatArchive) => {
    archive = boundChatArchive(next);
    if (!memoryOnly) {
      try { storage()?.setItem(CHAT_ARCHIVE_KEY, JSON.stringify(archive)); }
      catch { memoryOnly = true; }
    }
    listeners.forEach((listener) => listener());
  };
  const start = () => {
    const current = snapshot();
    const time = now();
    const session: ChatSession = { id: newId(), title: "New conversation", createdAt: time, updatedAt: time, messages: [] };
    save({ ...current, activeId: session.id, sessions: [session, ...current.sessions.filter((entry) => entry.messages.length)] });
    return session.id;
  };
  return {
    getSnapshot: snapshot,
    getServerSnapshot: () => EMPTY_CHAT_ARCHIVE,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reload() {
      if (memoryOnly) return;
      const current = snapshot();
      try {
        const restored = readChatArchive(storage()?.getItem(CHAT_ARCHIVE_KEY) ?? null);
        const time = now();
        const id = newId();
        archive = restored.sessions.length ? restored : { version: 1, activeId: id, sessions: [{ id, title: "New conversation", createdAt: time, updatedAt: time, messages: [] }] };
        if (archive.sessions.some((session) => session.id === current.activeId)) archive = { ...archive, activeId: current.activeId };
      } catch { memoryOnly = true; }
      listeners.forEach((listener) => listener());
    },
    start,
    update(id: string, changes: Partial<Pick<ChatSession, "messages" | "design">>) {
      const current = snapshot();
      save({ ...current, sessions: current.sessions.map((session) => {
        if (session.id !== id) return session;
        const updated = { ...session, ...changes, updatedAt: now() };
        const first = updated.messages.find((message) => message.role === "user");
        updated.title = first?.content.slice(0, 64) || "New conversation";
        return updated;
      }) });
    },
    select(id: string) {
      const current = snapshot();
      if (current.sessions.some((session) => session.id === id)) save({ ...current, activeId: id });
    },
    remove(id: string) {
      const current = snapshot();
      save({ ...current, sessions: current.sessions.filter((session) => session.id !== id) });
    },
    clear() {
      save(EMPTY_CHAT_ARCHIVE);
      try { storage()?.removeItem(CHAT_ARCHIVE_KEY); }
      catch { memoryOnly = true; }
    },
  };
}

export const chatArchive = createChatArchiveStore(() => typeof window === "undefined" ? null : window.localStorage);

export function subscribeChatArchive(listener: () => void) {
  const unsubscribe = chatArchive.subscribe(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === CHAT_ARCHIVE_KEY || event.key === null) chatArchive.reload(); };
  window.addEventListener("storage", onStorage);
  return () => { unsubscribe(); window.removeEventListener("storage", onStorage); };
}

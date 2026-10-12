import { BUILD_PHASES, type BuildFireResult, type BuildProposal, type BuildRun } from "@shared/build-routine";
import { isGodChatCard, parseQuestions, type GodChatCard, type GodChatMessage, type GodChatQuestion, type GodChatSource } from "@shared/god-chat";
import { isGodChatServedTier, type GodChatServedTier } from "@shared/god-chat-tiers";
import type { GithubIssueResult } from "@shared/github-issue";

export const CHAT_ARCHIVE_KEY = "lyjw.chat.v1";
export const CHAT_ARCHIVE_LIMITS = { sessions: 20, bytes: 2 * 1024 * 1024 } as const;
export type ChatDesign = { token: string; expiresAt: number; remaining: number };
export function activeChatDesign(design: ChatDesign | undefined, now = Date.now()): ChatDesign | undefined {
  return design && design.expiresAt > now && design.remaining > 0 ? design : undefined;
}

export function designSessionEnded(code: unknown): boolean {
  return code === "design_session_expired" || code === "design_session_exhausted";
}

export const DESIGN_END_REASONS = ["expired", "exhausted", "left"] as const;
export type DesignEndReason = (typeof DESIGN_END_REASONS)[number];

export function designEndReason(design: ChatDesign, now = Date.now()): DesignEndReason {
  return design.remaining <= 0 && design.expiresAt > now ? "exhausted" : "expired";
}

// issueOpened 是浏览器记下的已选出口：GitHub 原生提交不会回传结果，点过 Open issue 就当作这个计划已经选了 issue，两个出口都关掉。
export type ChatProposal = BuildProposal & { issue?: GithubIssueResult; issueOpened?: boolean; build?: BuildFireResult; run?: BuildRun };
// at 是收到卡片时这条回复已有的正文长度，卡片画在那个位置。
export type ChatShownCard = { card: GodChatCard; at: number };
export type ChatAnswer = { header: string; question: string; answer: string };
export type ChatBubble = GodChatMessage & {
  id?: string;
  tier?: GodChatServedTier | null;
  downgradedFrom?: GodChatServedTier;
  servedBy?: string;
  thinking?: string;
  lookups?: string[];
  docs?: { doc: string; path: string; url: string; section?: string }[];
  searches?: string[];
  steps?: string[];
  sources?: GodChatSource[];
  cards?: ChatShownCard[];
  // 同一条回复里开了设计会话、换规划者接手时正文已有的长度，分隔线画在这里。
  designAt?: number;
  // 这条回复的设计内容曾在同意状态下展示过：同意失效或被拒绝时不再隐藏它，没看过的照旧藏。
  designRevealed?: boolean;
  // 设计会话在这条回复之后结束：结束提示画在它下面。
  designEnded?: DesignEndReason;
  proposals?: ChatProposal[];
  asks?: GodChatQuestion[];
  answers?: ChatAnswer[];
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
const EMPTY_CHAT_ARCHIVE: ChatArchive = { version: 1, activeId: "", sessions: [] };
type ArchiveStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function chatReplyMessages(messages: ChatBubble[], user: ChatBubble & { id: string }, reply?: ChatBubble, keep: ChatBubble[] = []): ChatBubble[] {
  const turnIndex = messages.findIndex((message) => message.id === user.id);
  const history = turnIndex < 0 ? messages : messages.slice(0, turnIndex);
  return reply ? [...history, user, ...keep, reply] : history;
}

export type ChatResumePoint = { at: number; keep: ChatBubble[]; handoff: boolean };

// 最后一条访客消息还缺盖章的回复时，补发从哪接。交接回复由普通对话盖章（trace 不带 design），设计开场推迟到同意后：
// 盖了章的交接留着，规划者的回复接在它后面；没盖章的半截回复由补发整条重来。规划者的回复盖了章就算完成，刷新不再补发。
export function chatResumePoint(messages: ChatBubble[]): ChatResumePoint | null {
  const at = messages.map((message) => message.role).lastIndexOf("user");
  if (at < 0) return null;
  const next = messages[at + 1];
  const after = messages.length - 1 - at;
  if (next?.seal !== undefined && next.designAt !== undefined && !next.trace?.design) {
    return after === 1 || (after === 2 && !messages[at + 2].seal) ? { at, keep: [next], handoff: false } : null;
  }
  return after === 0 || (after === 1 && !next.seal) ? { at, keep: [], handoff: next?.designAt !== undefined } : null;
}

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const optionalString = (value: unknown) => value === undefined || typeof value === "string";

function validRun(value: unknown): boolean {
  if (!object(value) || typeof value.runId !== "string" || typeof value.branch !== "string" || !(BUILD_PHASES as readonly string[]).includes(String(value.phase))) return false;
  if (!optionalString(value.reason) || !optionalString(value.progress)) return false;
  if (value.pr !== undefined && (!object(value.pr) || typeof value.pr.number !== "number" || typeof value.pr.url !== "string" || typeof value.pr.headSha !== "string")) return false;
  return ["ci", "preview", "review"].every((key) => value[key] === undefined || (object(value[key]) && typeof value[key].state === "string" && optionalString(value[key].url)));
}

function validBubble(value: unknown): value is ChatBubble {
  if (!object(value) || !["user", "assistant"].includes(String(value.role)) || typeof value.content !== "string") return false;
  if (value.cards !== undefined && (!Array.isArray(value.cards) || !value.cards.every((card) => object(card) && typeof card.card === "string" && typeof card.at === "number"))) return false;
  if (value.proposals !== undefined && (!Array.isArray(value.proposals) || !value.proposals.every((proposal) => {
    if (!object(proposal) || typeof proposal.token !== "string" || typeof proposal.expiresAt !== "number" || !object(proposal.plan)) return false;
    const plan = proposal.plan;
    if (typeof plan.title !== "string" || typeof plan.spec !== "string" || !strings(plan.acceptance) || !strings(plan.paths)) return false;
    if (proposal.issue && (!object(proposal.issue) || typeof proposal.issue.url !== "string" || typeof proposal.issue.number !== "number")) return false;
    if (proposal.issueOpened !== undefined && proposal.issueOpened !== true) return false;
    if (proposal.build && (!object(proposal.build) || typeof proposal.build.runId !== "string" || typeof proposal.build.statusToken !== "string" || typeof proposal.build.branch !== "string")) return false;
    return proposal.run === undefined || validRun(proposal.run);
  }))) return false;
  if (value.asks !== undefined && !parseQuestions(value.asks)) return false;
  if (value.designAt !== undefined && typeof value.designAt !== "number") return false;
  if (value.designRevealed !== undefined && value.designRevealed !== true) return false;
  if (value.designEnded !== undefined && !(DESIGN_END_REASONS as readonly unknown[]).includes(value.designEnded)) return false;
  if (value.answers !== undefined && (!Array.isArray(value.answers) || !value.answers.every((answer) => object(answer) && ["header", "question", "answer"].every((key) => typeof answer[key] === "string")))) return false;
  if (["lookups", "searches", "steps"].some((key) => value[key] !== undefined && !strings(value[key]))) return false;
  if (value.docs !== undefined && (!Array.isArray(value.docs) || !value.docs.every((doc) => object(doc) && typeof doc.path === "string" && typeof doc.url === "string" && optionalString(doc.section)))) return false;
  if (value.sources !== undefined && (!Array.isArray(value.sources) || !value.sources.every((source) => object(source) && typeof source.url === "string" && typeof source.title === "string"))) return false;
  return ["id", "thinking", "seal", "planToken", "servedBy"].every((key) => optionalString(value[key])) && (value.tier === undefined || value.tier === null || isGodChatServedTier(value.tier)) && (value.downgradedFrom === undefined || isGodChatServedTier(value.downgradedFrom));
}

// 卡片清单会变：存档里已不登记的卡片只是不再画，整段对话照留。
function dropRetiredCards(session: ChatSession): ChatSession {
  if (!session.messages.some((message) => message.cards?.some(({ card }) => !isGodChatCard(card)))) return session;
  return { ...session, messages: session.messages.map(({ cards, ...message }) => {
    const kept = cards?.filter(({ card }) => isGodChatCard(card));
    return kept?.length ? { ...message, cards: kept } : message;
  }) };
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
    return boundChatArchive({ version: 1, activeId: typeof value.activeId === "string" ? value.activeId : "", sessions: sessions.map(dropRetiredCards) });
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

export function createChatArchiveStore(storage: () => ArchiveStorage | null, newId: () => string = () => crypto.randomUUID(), now = () => Date.now()) {
  let archive: ChatArchive | undefined;
  let memoryOnly = false;
  const listeners = new Set<() => void>();
  const blankSession = (): ChatSession => {
    const time = now();
    return { id: newId(), title: "New conversation", createdAt: time, updatedAt: time, messages: [] };
  };
  const snapshot = () => {
    if (!archive) {
      try { archive = readChatArchive(storage()?.getItem(CHAT_ARCHIVE_KEY) ?? null); }
      catch { archive = EMPTY_CHAT_ARCHIVE; memoryOnly = true; }
      const resumed = archive.sessions.find((session) => session.id === archive?.activeId);
      if (!archive.sessions.length || !activeChatDesign(resumed?.design, now())) {
        const session = blankSession();
        archive = { version: 1, activeId: session.id, sessions: [session, ...archive.sessions.filter((entry) => entry.messages.length)] };
      }
    }
    return archive;
  };
  const save = (next: ChatArchive, persist = true) => {
    archive = persist ? boundChatArchive(next) : next;
    if (persist && !memoryOnly) {
      try { storage()?.setItem(CHAT_ARCHIVE_KEY, JSON.stringify(archive)); }
      catch { memoryOnly = true; }
    }
    listeners.forEach((listener) => listener());
  };
  const update = (id: string, changes: Partial<Pick<ChatSession, "messages" | "design">>, { persist = true }: { persist?: boolean } = {}) => {
    const current = snapshot();
    save({ ...current, sessions: current.sessions.map((session) => {
      if (session.id !== id) return session;
      const updated = { ...session, ...changes, updatedAt: now() };
      const first = updated.messages.find((message) => message.role === "user");
      updated.title = first?.content.slice(0, 64) || "New conversation";
      return updated;
    }) }, persist);
  };
  const start = () => {
    const current = snapshot();
    const session = blankSession();
    save({ ...current, activeId: session.id, sessions: [session, ...current.sessions.filter((entry) => entry.messages.length)] });
    return session.id;
  };
  return {
    getSnapshot: snapshot,
    getServerSnapshot: () => EMPTY_CHAT_ARCHIVE,
    session: (id: string) => snapshot().sessions.find((session) => session.id === id),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reload() {
      if (memoryOnly) return;
      const current = snapshot();
      try {
        const restored = readChatArchive(storage()?.getItem(CHAT_ARCHIVE_KEY) ?? null);
        const blank = restored.sessions.length ? null : blankSession();
        archive = blank ? { version: 1, activeId: blank.id, sessions: [blank] } : restored;
        if (archive.sessions.some((session) => session.id === current.activeId)) archive = { ...archive, activeId: current.activeId };
      } catch { memoryOnly = true; }
      listeners.forEach((listener) => listener());
    },
    start,
    update,
    endDesign(id: string, reason: DesignEndReason, { persist = true }: { persist?: boolean } = {}) {
      const session = snapshot().sessions.find((entry) => entry.id === id);
      if (!session?.design) return;
      const last = session.messages.findLastIndex((message) => message.role === "assistant");
      const messages = last < 0 ? session.messages : session.messages.map((message, index) => index === last ? { ...message, designEnded: reason } : message);
      update(id, { design: undefined, messages }, { persist });
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

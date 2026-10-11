import type { GodChatEvent, GodChatMessage } from "@shared/god-chat";

export type DesignTurnInput =
  | { kind: "open"; requestId: string; latest: string; history: GodChatMessage[] }
  | { kind: "reply"; requestId: string; latest: string; text: string }
  | { kind: "resume"; requestId: string; latest: string };

// prepareTurn 时落下的回合草稿：之后无论是首轮投递还是断线 resume，提交内容都从它重建。
export type DesignDraft = { kind: "open"; history: GodChatMessage[] } | { kind: "reply"; text: string };

export type DesignTurnResult = { complete: boolean; asked: boolean; planToken?: string; lead?: string; views: string[] };

export type DesignFrame = { type: "event"; event: GodChatEvent } | { type: "result"; result: DesignTurnResult };

export type DesignApi = {
  create(designId: string, expiresAt: number): Promise<string>;
  matches(sessionId: string, requestId: string, latest: string): Promise<boolean>;
  stream(sessionId: string, input: DesignTurnInput, signal: AbortSignal): Promise<Response>;
  cancel(sessionId: string, requestId: string): Promise<void>;
};

export type DesignTurn = {
  requestId: string;
  latest: string;
  state: "prepared" | "submitted" | "finished" | "cancelled";
  preparedAt: number;
  input?: string;
  cutoff?: number;
  // 终态条目上界：旧回合的重放只投影 (cutoff, endEntryId] 这一段，不会把后一个回合的输出重放进来。
  endEntryId?: number;
  views: string[];
  reads: string[];
  draft?: DesignDraft;
  result?: DesignTurnResult;
  // 结算时写给访客的收场句（过期、超支、意外中断）：重放时在 result 帧前原样再发一次。
  notice?: string;
};

// 每个 requestId 一条记录：旧请求的重放拿回自己的输入、截点与结果，不会改写最新回合与挂起的交互。
// current 指向最近受理的回合，上限就是设计会话的回合上限，多余的终态记录会被裁剪。
export type TurnBook = {
  current?: string;
  turns: Record<string, DesignTurn>;
};

export const MAX_TURN_RECORDS = 16;

// 挂起的题目或计划：访客的下一个输入就是它的答复，跨重启也要能找回。
export type PendingInteraction = { requestId: string; taskId: string; event: GodChatEvent; lead?: string };

export type DesignMeta = { designId: string; expiresAt: number; createdAt: number };

// prepareTurn 写下到 stream 提交之间留了缝：配额被拒或请求中途死掉都会留下 prepared 记录，过了这个窗口就让它失效。
export const PREPARED_STALE_MS = 60_000;

// requestId 绑定「上一条已盖章的助手回复 + 访客最新一条」：重发与断线重连得到同一个键，同一句问话换个上下文是新回合。
export async function designRequestId(history: GodChatMessage[]): Promise<string> {
  const latest = history[history.length - 1]?.content ?? "";
  const previousSeal = history.length > 1 ? history[history.length - 2]?.seal ?? "" : "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ previousSeal, latest })));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// 访客那段对话原样转给规划者，标签只用来分清说话人；内容是不可信的公开输入，系统提示词里已经说明。
export function openingBrief(history: GodChatMessage[]): string {
  const turns = history.map((message) => message.role === "user" ? `<visitor>\n${message.content}\n</visitor>` : `<assistant>\n${message.content}\n</assistant>`);
  return `The visitor opened this design session from the homepage chat. The conversation so far, oldest first; the last visitor message is the change to plan:\n\n${turns.join("\n\n")}\n\nStart planning that change now; do not ask the visitor to describe it again. Write everything the visitor sees in the language of their messages.`;
}

export const VISITOR_REPLY_PREFIX = "The visitor replied to the question or plan shown in the previous run:\n";

export function turnInputText(input: DesignDraft, pending: boolean): string {
  return input.kind === "open" ? openingBrief(input.history) : pending ? `${VISITOR_REPLY_PREFIX}${input.text}` : input.text;
}

export type TurnAdmission =
  | { status: "prepared"; turn: DesignTurn }
  | { status: "attached" | "finished"; turn: DesignTurn }
  | { status: "busy" }
  | { status: "mismatch" };

// 一个会话同一时刻只进行一个回合：同一 requestId 的重试挂回同一回合，不同的并发回合拒绝而不是排队（配额在请求前就扣过）。
// submitted 的当前回合必须先经 reconcile 定案——这里只看持久状态，不探测 pi 的运行态。
export function admitTurn(book: TurnBook, requestId: string, latest: string, now: number): TurnAdmission {
  const existing = book.turns[requestId];
  if (existing) {
    if (existing.latest !== latest) return { status: "mismatch" };
    return { status: existing.state === "finished" ? "finished" : "attached", turn: existing };
  }
  const current = book.current ? book.turns[book.current] : undefined;
  if (current && (current.state === "submitted" || (current.state === "prepared" && now - current.preparedAt < PREPARED_STALE_MS))) {
    return { status: "busy" };
  }
  return { status: "prepared", turn: { requestId, latest, state: "prepared", preparedAt: now, views: [], reads: [] } };
}

// 记录上限宽松于回合上限：超出时先丢最旧的终态与过期草稿，正在进行的与新鲜的 prepared 一律留下。
export function trimTurnBook(book: TurnBook, now: number): void {
  const ids = Object.keys(book.turns);
  if (ids.length <= MAX_TURN_RECORDS) return;
  const droppable = ids
    .filter((id) => {
      const turn = book.turns[id];
      if (id === book.current || turn.state === "submitted") return false;
      return turn.state !== "prepared" || now - turn.preparedAt >= PREPARED_STALE_MS;
    })
    .sort((a, b) => book.turns[a].preparedAt - book.turns[b].preparedAt);
  for (const id of droppable) {
    if (Object.keys(book.turns).length <= MAX_TURN_RECORDS) break;
    delete book.turns[id];
  }
}

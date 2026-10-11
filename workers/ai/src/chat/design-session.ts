import { DurableObject } from "cloudflare:workers";

import { Lifecycle } from "agents/lifecycle";
import { openPiSessionStore, PiHarness, ROOT_SESSION, type PiSession } from "agents/harness/pi";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentEvent, AgentEventStream, Conversation, Cursor, EntryId, EntryRecord } from "@earendil-works/pi-durable";

import type { GodChatEvent } from "@shared/god-chat";
import { GOD_CHAT_TIER_INFO } from "@shared/god-chat-tiers";

import { readBoundedBytes } from "../build/http";
import type { Env } from "../runtime";
import { fetchProjectDoc } from "../tools/project-docs";
import { DESIGN_REQUEST_LIMITS, emptyDesignBudget, type DesignBudget, type DesignBudgetStore } from "./design-budget";
import { DESIGN_BUDGET_CENTS } from "./design";
import { openRepository, type DesignerRepository } from "./designer-repository";
import { entryText, openDesignerHarness, repoBlobUrl, toolResultEvent, type DesignerDeps, type DesignerRecords } from "./designer-runtime";
import {
  admitTurn,
  trimTurnBook,
  turnInputText,
  type DesignFrame,
  type DesignMeta,
  type DesignTurn,
  type DesignTurnInput,
  type DesignTurnResult,
  type PendingInteraction,
  type TurnBook,
} from "./design-turns";
import { anthropicFetch } from "./egress";

const BG = BACKGROUND_CONTEXT;
const STREAM_PATH = "/stream";
const MAX_STREAM_BODY = DESIGN_REQUEST_LIMITS.requestBytes;
const RECONCILE_WAIT_MS = 10_000;

export type PrepareResult =
  | { status: "prepared" | "attached" | "finished" }
  | { status: "busy" | "mismatch" | "expired" | "uninitialized" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

// 出错只回通用信息：提示词、工具参数、供应商正文与凭据永远不出 Durable Object。
function fail(status: number, error: string, code?: string): Response {
  return json({ error, ...(code && { code }) }, status);
}

function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

export class DesignSession extends DurableObject<Env> {
  private readonly lifecycle: Lifecycle<Env>;
  private readonly harness: PiHarness;
  private readonly records: DesignerRecords;
  private disposed = false;
  private disposing?: Promise<void>;
  private started?: Promise<void>;
  private repo?: Promise<DesignerRepository>;
  private repoSha?: string;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS designer_records (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    this.records = {
      get: (key) => this.ctx.storage.sql.exec("SELECT value FROM designer_records WHERE key = ?", key).toArray()[0]?.value as string | undefined,
      put: (key, value) => void this.ctx.storage.sql.exec("INSERT OR REPLACE INTO designer_records(key, value) VALUES (?, ?)", key, value),
      delete: (key) => void this.ctx.storage.sql.exec("DELETE FROM designer_records WHERE key = ?", key),
    };
    this.lifecycle = Lifecycle.install(this);
    this.harness = new PiHarness({
      defaults: { model: { provider: "anthropic", id: GOD_CHAT_TIER_INFO.opus.model }, thinkingLevel: GOD_CHAT_TIER_INFO.opus.effort },
      harness: async ({ context }) => openDesignerHarness(await openPiSessionStore(this.ctx.storage), context, await this.deps()),
    });
    this.lifecycle.use(this.harness);
  }

  private read<T>(key: string): T | undefined {
    const saved = this.records.get(key);
    return saved === undefined ? undefined : JSON.parse(saved) as T;
  }

  private write(key: string, value: unknown): void {
    this.records.put(key, JSON.stringify(value));
  }

  private turnBook(): TurnBook {
    return this.read<TurnBook>("turns") ?? { turns: {} };
  }

  private saveBook(book: TurnBook): void {
    this.write("turns", book);
  }

  private currentTurn(book: TurnBook): DesignTurn | undefined {
    return book.current ? book.turns[book.current] : undefined;
  }

  // 析构中视同已析构：删完存储前，入口、模型守卫与工具写库一律不再放新工作进来，也不让迟到写把表写活。
  private gone(): boolean {
    return this.disposed || this.disposing !== undefined;
  }

  private startLifecycle(): Promise<void> {
    if (this.gone()) return Promise.reject(new Error("This design session has ended."));
    this.started ??= this.lifecycle.start();
    return this.started;
  }

  protected readStatus(path: string): Promise<Response> {
    return this.env.PUBLIC_STATUS.readStatus(path);
  }

  private repository(): Promise<DesignerRepository> {
    this.repo ??= openRepository({ env: this.env, store: this.records }).then((repo) => {
      this.repoSha = repo.sha;
      return repo;
    });
    return this.repo;
  }

  private budget(): DesignBudgetStore {
    return {
      change: (update) => Promise.resolve(this.ctx.storage.transactionSync(() => {
        const budget = this.read<DesignBudget>("budget") ?? emptyDesignBudget();
        const out = update(budget);
        this.write("budget", budget);
        return out;
      })),
      active: async () => this.active(),
    };
  }

  // 会话还活着且没在等访客答复时模型请求才被放行；取消、过期与析构在这里收口。
  private active(): boolean {
    if (this.gone()) return false;
    const meta = this.read<DesignMeta>("meta");
    if (!meta || meta.expiresAt <= Date.now()) return false;
    if (this.currentTurn(this.turnBook())?.state === "cancelled") return false;
    if (this.read<PendingInteraction>("pending") !== undefined) return false;
    return true;
  }

  private persistPending(record: PendingInteraction): "placed" | "held" | "conflict" {
    return this.ctx.storage.transactionSync(() => {
      if (this.gone()) return "conflict" as const;
      const existing = this.read<PendingInteraction>("pending");
      if (!existing) {
        this.write("pending", record);
        return "placed" as const;
      }
      return existing.taskId === record.taskId ? "held" as const : "conflict" as const;
    });
  }

  // 配额登记是唯一放行依据：prepareTurn 会留下未受理的草稿，靠这一条挡住绕过配额的重放。
  private async admitted(requestId: string): Promise<boolean> {
    if (this.gone()) return false;
    const meta = this.read<DesignMeta>("meta");
    if (!meta || !this.env.BUILD_COORDINATOR) return false;
    try {
      return await this.env.BUILD_COORDINATOR.getByName("global").hasDesignAdmission(meta.designId, requestId);
    } catch {
      return false;
    }
  }

  private async deps(): Promise<DesignerDeps> {
    const key = this.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("The planner is unavailable.");
    return {
      env: this.env,
      repo: await this.repository(),
      io: { readStatus: (path) => this.readStatus(path), readDoc: fetchProjectDoc },
      records: this.records,
      budget: this.budget(),
      modelFetch: anthropicFetch(this.env) ?? fetch,
      anthropicKey: key,
      turn: () => {
        const turn = this.currentTurn(this.turnBook());
        return turn && { requestId: turn.requestId, views: turn.views, reads: turn.reads };
      },
      saveTurnLedger: (views, reads) => {
        this.ctx.storage.transactionSync(() => {
          if (this.gone()) return;
          const book = this.turnBook();
          const turn = this.currentTurn(book);
          if (turn) {
            book.turns[turn.requestId] = { ...turn, views, reads };
            this.saveBook(book);
          }
        });
      },
      persistPending: (record) => this.persistPending(record),
    };
  }

  private session(): PiSession {
    return this.harness.session(ROOT_SESSION);
  }

  // initialize 是唯一允许建状态的入口；没有 meta 时其它调用一律拒绝，disposed 之后任何调用都不再复活对象。
  async initialize(designId: string, expiresAt: number): Promise<void> {
    if (this.gone()) throw new Error("This design session has ended.");
    const existing = this.read<DesignMeta>("meta");
    if (existing) {
      if (existing.designId !== designId) throw new Error("This design session is already initialized.");
      return;
    }
    await this.repository();
    await this.startLifecycle();
    this.write("meta", { designId, expiresAt, createdAt: Date.now() } satisfies DesignMeta);
  }

  // 持久状态是 submitted 而 pi 已经结案时，先把结果与截点落定再放行新回合：浏览器断开期间的完成不会让后续请求永远忙等。
  // 投递持久化与 pi 入队之间崩溃留下的提交在这里补投；receipt.accepted 为假说明 pi 已记录，等待只取已落定结果。
  private async reconcileCurrent(book: TurnBook, ignore?: string): Promise<"idle" | "busy"> {
    const current = this.currentTurn(book);
    if (!current || current.state !== "submitted" || !current.input || current.requestId === ignore) return "idle";
    const session = this.session();
    const pending = await this.harness.pending({ session: ROOT_SESSION }).catch(() => null);
    if (pending === null || pending.some((op) => op.operationId === current.requestId)) return "busy";
    const receipt = await session.submit(current.input, { operationId: current.requestId }).catch(() => null);
    if (!receipt || receipt.accepted) return "busy";
    try {
      const settled = await session.wait(current.requestId, AbortSignal.timeout(RECONCILE_WAIT_MS));
      const terminal = await this.committedMax(session);
      await this.settleTurn(current.requestId, settled.status === "done", false, terminal);
      return "idle";
    } catch {
      return "busy";
    }
  }

  private async committedMax(session: PiSession): Promise<number> {
    const messages = await session.messages();
    return messages.reduce((max, entry) => Math.max(max, entry.id), 0);
  }

  // 只在回合仍 submitted 时落定：cancelled 是终态，迟到完成不得改写它，也不得覆盖更新的回合。
  // 存档里写逻辑结局（挂起卡、过期、超支、完成都算定案）；本次观察的投影损坏只降这一回放，不污染已盖章的回合。
  private async settleTurn(requestId: string, done: boolean, corrupt: boolean, terminal: number): Promise<{ result: DesignTurnResult; notice?: string } | null> {
    const logical = await this.turnResult(requestId, done);
    const outcome = corrupt
      ? { result: { complete: false, asked: false, views: logical.result.views }, notice: "\n\n[The planner stopped unexpectedly. Send another message to try again.]" }
      : logical;
    this.ctx.storage.transactionSync(() => {
      if (this.gone()) return;
      const book = this.turnBook();
      const turn = book.turns[requestId];
      if (!turn || turn.state !== "submitted") return;
      const endEntryId = Math.max(terminal, turn.cutoff ?? 0);
      book.turns[requestId] = { ...turn, state: "finished", result: logical.result, endEntryId, ...(logical.notice && { notice: logical.notice }) };
      this.saveBook(book);
    });
    return outcome;
  }

  // 已认识的请求只查自己那条记录就挂回：不探测 pi 运行态、不挪 current，重试永远接同一回合。
  // 只有新请求才做运行态对账：submitted 的当前回合先定案，pi 还忙（含取消中的 abort）一律拒绝而不是顶掉。
  async prepareTurn(requestId: string, latest: string, draft: DesignTurn["draft"]): Promise<PrepareResult> {
    if (this.gone()) return { status: "uninitialized" };
    const meta = this.read<DesignMeta>("meta");
    if (!meta) return { status: "uninitialized" };
    if (meta.expiresAt <= Date.now()) return { status: "expired" };
    await this.startLifecycle();
    const book = this.turnBook();
    if (book.turns[requestId]) return { status: admitTurn(book, requestId, latest, Date.now()).status } as PrepareResult;
    if (await this.reconcileCurrent(book) === "busy") return { status: "busy" };
    if (await this.session().busy().catch(() => true)) return { status: "busy" };
    return this.ctx.storage.transactionSync(() => {
      const fresh = this.turnBook();
      const admitted = admitTurn(fresh, requestId, latest, Date.now());
      if (admitted.status === "prepared") {
        fresh.turns[requestId] = { ...admitted.turn, draft };
        fresh.current = requestId;
        trimTurnBook(fresh, Date.now());
        this.saveBook(fresh);
      }
      return { status: admitted.status } as PrepareResult;
    });
  }

  async matches(requestId: string, latest: string): Promise<boolean> {
    if (this.gone()) return false;
    const meta = this.read<DesignMeta>("meta");
    if (!meta || meta.expiresAt <= Date.now()) return false;
    const turn = this.turnBook().turns[requestId];
    return turn?.latest === latest && turn.state !== "cancelled" && await this.admitted(requestId);
  }

  // 只停 requestId 对得上的那个回合：晚到的取消不会误杀后一个回合；abort 未落地的窗口由 prepareTurn 的 busy 探测兜住。
  async cancel(requestId: string): Promise<void> {
    if (this.gone()) return;
    const submitted = this.ctx.storage.transactionSync(() => {
      const book = this.turnBook();
      const turn = book.turns[requestId];
      if (!turn || (turn.state !== "prepared" && turn.state !== "submitted")) return false;
      book.turns[requestId] = { ...turn, state: "cancelled" };
      this.saveBook(book);
      return turn.state === "submitted";
    });
    if (submitted) {
      await this.startLifecycle();
      await this.session().abort(requestId);
    }
  }

  // 析构把整个会话停下来：先并轨起步中的生命周期，再依次收闹钟、pi 后台泵、生命周期，最后整块删除。
  // 任何一步失败都向上抛并清掉在途承诺，同实例重试从头再来；协调器只在成功后才忘记录。
  async disposeSession(): Promise<void> {
    if (this.disposed) return;
    if (this.disposing) return this.disposing;
    const work = (async () => {
      await this.started?.then(() => undefined, () => undefined);
      await this.lifecycle.disableAlarms();
      if (this.lifecycle.isStarted()) {
        await (await this.harness.conversation(ROOT_SESSION)).abort(BG, { background: true });
      }
      await this.lifecycle.dispose();
      await this.ctx.storage.deleteAll();
      this.disposed = true;
    })();
    this.disposing = work;
    try {
      await work;
    } finally {
      this.disposing = undefined;
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== STREAM_PATH) return new Response("Not found", { status: 404 });
    let input: DesignTurnInput;
    try {
      const bytes = await readBoundedBytes(request.body, MAX_STREAM_BODY);
      const parsed: unknown = bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null;
      input = parsed as DesignTurnInput;
      if (typeof input?.requestId !== "string" || typeof input?.latest !== "string" || !["open", "reply", "resume"].includes(input?.kind)) return fail(400, "Invalid design turn.");
    } catch {
      return fail(400, "Invalid design turn.");
    }
    return this.stream(input, request.signal);
  }

  // /stream 的受理段一次只进一个：并发 attach 在 pi 的提交/事件入口上是串行的，输家挂到赢家写下的持久记录。
  // 放行之后的观察泵各自独立，不占闸门。
  private streamGate: Promise<void> = Promise.resolve();

  private async stream(input: DesignTurnInput, signal: AbortSignal): Promise<Response> {
    const prior = this.streamGate;
    let release!: () => void;
    this.streamGate = prior.then(() => new Promise<void>((resolve) => { release = resolve; }));
    await prior;
    try {
      return await this.openStream(input, signal);
    } finally {
      release();
    }
  }

  private async openStream(input: DesignTurnInput, signal: AbortSignal): Promise<Response> {
    const meta = this.read<DesignMeta>("meta");
    if (this.gone() || !meta) return fail(400, "This design session is invalid or expired.");
    if (meta.expiresAt <= Date.now()) return fail(410, "This design session has expired.");
    let turn = this.turnBook().turns[input.requestId];
    if (!turn || turn.latest !== input.latest) {
      return fail(409, "The interrupted reply could not be recovered.", "nothing_to_resume");
    }
    if (turn.state === "cancelled") return fail(409, "This design turn was cancelled.");
    // 未受理的草稿永远不进 pi：配额被拒的回合连 resume:true 也不能换得一次模型调用。
    if (!await this.admitted(input.requestId)) {
      return fail(409, "The interrupted reply could not be recovered.", "nothing_to_resume");
    }
    await this.startLifecycle();
    const session = this.session();
    const conversation = await this.harness.conversation(ROOT_SESSION);
    if (turn.state === "prepared") {
      if (!turn.draft) return fail(409, "The interrupted reply could not be recovered.", "nothing_to_resume");
      const pending = this.read<PendingInteraction>("pending");
      const text = turnInputText(turn.draft, pending !== undefined);
      const page = await conversation.entries({ order: "descending" }, 1, undefined, BG);
      const cutoff = Number(page.items[0]?.id ?? 0);
      // 只对别的回合做运行态对账：本 requestId 已被并发赢家提交时跳过对账，落到下面事务按持久记录挂回。
      if (await this.reconcileCurrent(this.turnBook(), input.requestId) === "busy") {
        return fail(409, "The planner is still replying to the previous message. Reconnect to see its progress.", "busy");
      }
      // 先落精确的输入与截点再投递：提交前崩溃时，重放用同一 operationId 重投，不会产生第二条用户消息。
      const submitted = this.ctx.storage.transactionSync(() => {
        const book = this.turnBook();
        const fresh = book.turns[input.requestId];
        if (!fresh || fresh.state !== "prepared") return null;
        // 过期草稿不得把 current 顶回已 submitted 的别的回合：按忙退回，让上游走复读。
        const occupying = book.current ? book.turns[book.current] : undefined;
        if (occupying && occupying.requestId !== input.requestId && occupying.state === "submitted") return "busy" as const;
        const next: DesignTurn = { ...fresh, state: "submitted", input: text, cutoff };
        book.turns[input.requestId] = next;
        book.current = input.requestId;
        this.saveBook(book);
        if (next.draft?.kind === "reply") this.records.delete("pending");
        return next;
      });
      if (submitted === "busy") {
        return fail(409, "The planner is still replying to the previous message. Reconnect to see its progress.", "busy");
      }
      if (!submitted) {
        // 同 requestId 并发流的输家：赢家已落 submitted/finished，按持久记录挂回，不重算输入与截点。
        const settled = this.turnBook().turns[input.requestId];
        if (!settled || settled.latest !== input.latest || (settled.state !== "submitted" && settled.state !== "finished")) {
          return fail(409, "The interrupted reply could not be recovered.", "nothing_to_resume");
        }
        turn = settled;
      } else {
        turn = submitted;
      }
    }
    // 初次投递与持久 submitted 的重放走同一行：operationId 幂等，pi 已记录时是 no-op，缝里崩溃时是补投。
    if (turn.state === "submitted" && turn.input !== undefined) {
      await session.submit(turn.input, { operationId: turn.requestId });
    }
    const events = await session.events();
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    this.ctx.waitUntil(this.pump(events, session, conversation, turn, writer, signal).catch(() => {}));
    return new Response(readable, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
  }

  // 断线只停观察者：watch 挂着 lifecycle 的醒班任务，pi 的回合在后台继续跑，重连后从截点补放。
  // 快照与注册在 attach 时原子捕获：先发快照里的在途部分，再按条目页投影已提交文本，partial/final 按截点与前缀去重。
  private async pump(stream: AgentEventStream, session: PiSession, conversation: Conversation, turn: DesignTurn, writer: WritableStreamDefaultWriter<Uint8Array>, signal: AbortSignal): Promise<void> {
    const encoder = new TextEncoder();
    const seen = new Set<number>();
    const started = new Set<string>();
    const parts = new Map<number, string>();
    const replay = turn.state === "finished";
    let bound = turn.endEntryId ?? Number.MAX_SAFE_INTEGER;
    // 重放只读归档；活动流在 wait 落定后冻结边界，后一回合的直播事件不再进这条流。
    let frozen = replay;
    let open = true;
    let corrupt = false;
    let emittedText = false;
    let newAttempt = false;
    const send = async (frame: DesignFrame) => {
      if (!open) return;
      try { await writer.write(encoder.encode(`${JSON.stringify(frame)}\n`)); } catch { open = false; }
    };
    const emitText = async (text: string) => {
      if (!text) return;
      if (newAttempt) await send({ type: "event", event: { type: "text", text: "\n\n" } });
      newAttempt = false;
      emittedText = true;
      await send({ type: "event", event: { type: "text", text } });
    };
    const joinParts = () => [...parts.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value).join("");
    const emitPart = async (index: number, full: string) => {
      const suffix = full.slice(commonPrefix(parts.get(index) ?? "", full));
      parts.set(index, full);
      await emitText(suffix);
    };
    // 已提交条目对在途部分：同一尝试只补尾巴；对不上前缀的是重生成的新尝试，按段另起一段。
    const project = async (entry: EntryRecord) => {
      if (entry.id <= (turn.cutoff ?? 0) || entry.id > bound || seen.has(entry.id)) return;
      seen.add(entry.id);
      const full = entryText(entry);
      if (full !== null) {
        const partial = joinParts();
        parts.clear();
        if (partial && full.startsWith(partial)) await emitText(full.slice(partial.length));
        else if (full) {
          if (emittedText) await emitText("\n\n");
          await emitText(full);
        }
        return;
      }
      const event = toolResultEvent(entry);
      if (!event) return;
      const callId = (entry.model?.[0] as { toolCallId?: string } | undefined)?.toolCallId;
      if (callId && started.has(callId)) return;
      await send({ type: "event", event });
    };
    const emitPartial = async (message: AssistantMessage) => {
      for (const [index, block] of message.content.entries()) {
        if (block.type === "text") await emitPart(index, block.text);
      }
    };
    const startCard = (name: string, args: Record<string, unknown>): GodChatEvent | null => {
      const clip = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 120);
      const path = typeof args.path === "string" ? args.path : "";
      if (name === "read") return path && this.repoSha ? { type: "doc", doc: "repo", path, url: repoBlobUrl(this.repoSha, path) } : null;
      if (name === "grep") return typeof args.query === "string" && args.query ? { type: "step", text: `Searched the code for “${clip(args.query)}”` } : null;
      if (name === "glob") return typeof args.pattern === "string" && args.pattern ? { type: "step", text: `Listed files matching ${clip(args.pattern)}` } : null;
      return null;
    };
    const handle = async (batch: readonly AgentEvent[]) => {
      for (const event of batch) {
        if (!open) return;
        // 冻结后只收归档条目事件的投影；在途部分与工具卡片属于下一回合，不再放进来。
        if (frozen && event.type !== "entry_appended" && event.type !== "message_end") continue;
        if (event.type === "snapshot") {
          for (const entry of event.entries) await project(entry);
          if (event.generation?.message) {
            if (joinParts()) newAttempt = true;
            parts.clear();
            await emitPartial(event.generation.message);
          }
        } else if (event.type === "entry_appended" || event.type === "message_end") {
          await project(event.entry);
        } else if (event.type === "message_start") {
          // 前一次尝试的半截文字保持原样；新尝试的正文从新的一段开始。
          if (joinParts()) newAttempt = true;
          parts.clear();
        } else if (event.type === "message_update") {
          for (const change of event.changes) {
            if (change.type === "text_start" && change.block.type === "text") await emitPart(change.contentIndex, change.block.text);
            else if (change.type === "text_delta") {
              const text = (parts.get(change.contentIndex) ?? "") + change.delta;
              parts.set(change.contentIndex, text);
              await emitText(change.delta);
            } else if (change.type === "block" && change.block.type === "text") await emitPart(change.contentIndex, change.block.text);
            else if (change.type === "message") await emitPartial(change.message);
          }
        } else if (event.type === "tool_execution_start") {
          const card = startCard(event.toolName, event.args);
          if (card) {
            started.add(event.toolCallId);
            await send({ type: "event", event: card });
          }
        }
      }
    };
    // 投影回调串行执行：一批里抛错记 corrupt，最后不把半截投影当成成功盖章。
    let chain: Promise<void> = Promise.resolve();
    const queue = (batch: readonly AgentEvent[]): Promise<void> => {
      chain = chain.then(() => handle(batch)).catch(() => { corrupt = true; });
      return chain;
    };
    // 归档补放：翻页只到边界为止；读失败向上抛，不许吞成空转录再盖成功结果。
    const drainCommitted = async () => {
      let cursor: Cursor | undefined;
      for (;;) {
        const page = await conversation.entries({ minEntryId: ((turn.cutoff ?? 0) + 1) as EntryId, order: "ascending" }, 100, cursor, BG);
        let reached = false;
        for (const entry of page.items) {
          if (entry.id > bound) { reached = true; break; }
          await project(entry);
        }
        if (reached || page.next === undefined) break;
        cursor = page.next;
      }
    };
    try {
      if (!replay) {
        for (const entry of stream.snapshot.entries) await project(entry);
        if (turn.requestId === this.currentTurn(this.turnBook())?.requestId && stream.snapshot.generation?.message) {
          await emitPartial(stream.snapshot.generation.message);
        }
        stream.start(queue);
        const settled = await session.wait(turn.requestId, signal);
        await chain;
        frozen = true;
        // 终态对账：wait 落定后先冻结上界，再把截点到上界之间漏掉的已提交条目补完，才出结果帧。
        const terminal = await this.committedMax(session);
        bound = Math.min(bound, terminal);
        await drainCommitted();
        const outcome = await this.settleTurn(turn.requestId, settled.status === "done", corrupt, terminal);
        if (outcome) {
          if (outcome.notice) await emitText(outcome.notice);
          await send({ type: "result", result: outcome.result });
        }
      } else {
        // 终态重放只吃自己 (cutoff, endEntryId] 内的归档条目：活动快照可能只留压缩后的尾巴，也会混进更新的回合。
        await drainCommitted();
        const stored = this.turnBook().turns[turn.requestId];
        if (stored?.notice) await emitText(stored.notice);
        await send({ type: "result", result: stored?.result ?? { complete: false, asked: false, views: stored?.views ?? [] } });
      }
    } catch {
      if (!signal.aborted) {
        const views = this.gone() ? [] : this.turnBook().turns[turn.requestId]?.views ?? [];
        await send({ type: "result", result: { complete: false, asked: false, views } });
      }
    } finally {
      open = false;
      await writer.close().catch(() => {});
      await stream.stop().catch(() => {});
    }
  }

  private async turnResult(requestId: string, done: boolean): Promise<{ result: DesignTurnResult; notice?: string }> {
    const pending = this.read<PendingInteraction>("pending");
    const views = this.turnBook().turns[requestId]?.views ?? [];
    if (pending && pending.requestId === requestId) {
      return {
        result: {
          complete: true,
          asked: pending.event.type === "ask",
          views,
          ...(pending.event.type === "plan" && { planToken: pending.event.token }),
          ...(pending.lead && { lead: pending.lead }),
        },
      };
    }
    const ended = (this.read<DesignMeta>("meta")?.expiresAt ?? 0) <= Date.now();
    const budget = this.read<DesignBudget>("budget");
    const spent = budget !== undefined
      && (budget.requests >= DESIGN_REQUEST_LIMITS.maxRequests || budget.chargedMicroUsd >= DESIGN_BUDGET_CENTS * 10_000 || budget.denied === true);
    if (ended || spent) {
      // 到期与超支是终态：半截回复连同说明盖章留给访客。
      return {
        result: { complete: true, asked: false, views },
        notice: ended
          ? "\n\n[This design session has expired. Continue in ordinary chat.]"
          : "\n\n(This design session has used its budget. Continue in ordinary chat.)",
      };
    }
    if (this.turnBook().turns[requestId]?.state === "cancelled") return { result: { complete: false, asked: false, views } };
    if (done) return { result: { complete: true, asked: false, views } };
    // 意外中断不盖章，访客重发另起一回合。
    return { result: { complete: false, asked: false, views }, notice: "\n\n[The planner stopped unexpectedly. Send another message to try again.]" };
  }
}

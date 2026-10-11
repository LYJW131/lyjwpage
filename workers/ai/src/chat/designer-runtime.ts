import { createModels, Type, type AnthropicOptions, type AssistantMessage, type Model, type Provider, type TSchema } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import type { Context } from "@earendil-works/chord";
import {
  AssistantEntry,
  createRegistry,
  defineExtension,
  defineTool,
  GenerationTask,
  Harness,
  hook,
  section,
  ToolResultEntry,
  ToolTask,
  type EntryRecord,
  type Extension,
  type Storage,
  type ToolExecutionResult,
} from "@earendil-works/pi-durable";

import { site } from "@/lib/site";
import type { StatusViewKey } from "@/lib/status-views";
import { PLAN_LABELS, textLanguage, visitorLanguage, type BuildProposal } from "@shared/build-routine";
import { parseQuestions, type GodChatEvent, type GodChatQuestion } from "@shared/god-chat";
import { GOD_CHAT_TIER_INFO } from "@shared/god-chat-tiers";

import { issuePlan } from "../build/plan";
import { checkBuildPlan } from "../build/validation";
import type { Env } from "../runtime";
import { newLedger, type ToolIO } from "../tools/registry";
import { SITE_STATUS_TOOL } from "../tools/site-status";
import { designBudgetFetch, type DesignBudgetStore } from "./design-budget";
import { ASK_VISITOR_TOOL, DESIGN_BUDGET_CENTS, PLANNER_PROMPT, PROPOSE_BUILD_TOOL } from "./design";
import { cleanPath, type DesignerRepository } from "./designer-repository";
import type { PendingInteraction } from "./design-turns";

const STEP_CHARS = 120;
const UI_WAITING = "A question or plan is already waiting for the visitor.";
const UI_TOOLS = new Set([ASK_VISITOR_TOOL.name, PROPOSE_BUILD_TOOL.name]);
const WAIT_TEXT = {
  ask: "The questions have been shown. This run is waiting for the visitor’s next message.",
  plan: "The plan has been shown. This run is waiting for the visitor’s next message.",
} as const;

// 应用层记录的同步读写：工具与钩子跑在 pi 任务里，自己的元数据不经 pi 的事务。
export type DesignerRecords = {
  get(key: string): string | undefined;
  put(key: string, value: string): void;
  delete(key: string): void;
};

export type DesignerDeps = {
  env: Env;
  repo: DesignerRepository;
  io: ToolIO;
  records: DesignerRecords;
  budget: DesignBudgetStore;
  modelFetch: typeof fetch;
  anthropicKey: string;
  // 正在进行的回合的元数据访问：requestId 记进挂起的交互，状态读进账本。
  turn(): { requestId: string; views: string[]; reads: string[] } | undefined;
  saveTurnLedger(views: string[], reads: string[]): void;
  // 原子占位：同一任务重放算已持有；别的交互占着就冲突。
  persistPending(record: PendingInteraction): "placed" | "held" | "conflict";
};

export function repoBlobUrl(sha: string, path: string): string {
  return `${site.repo}/blob/${sha}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > STEP_CHARS ? `${flat.slice(0, STEP_CHARS)}…` : flat;
}

const failure = (value: string): ToolExecutionResult => ({ content: [{ type: "text", text: value }], isError: true });
const waiting = (): ToolExecutionResult => ({ content: [{ type: "text", text: UI_WAITING }], isError: true, control: { terminate: true } });

const jsonSchema = <T>(schema: unknown): TSchema => Type.Unsafe<T>(schema as TSchema);

function repositoryTools(deps: DesignerDeps) {
  return [
    defineTool({
      name: "read",
      description: "Read lines from a regular text file in this design session's fixed repository snapshot. Paths are repository-relative. The result includes line numbers and reports truncation.",
      parameters: Type.Object({
        path: Type.String(),
        offset: Type.Optional(Type.Integer({ minimum: 1 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 300 })),
      }, { additionalProperties: false }),
      replay: "safe",
      async execute(args) {
        const clean = cleanPath(args.path);
        const out = clean ? await deps.repo.read(clean, args.offset, args.limit) : { error: `No such file in the repository snapshot: ${String(args.path)}` };
        if ("error" in out) return failure(out.error);
        return {
          content: [{ type: "text", text: out.text }],
          details: { event: { type: "doc", doc: "repo", path: clean!, url: repoBlobUrl(deps.repo.sha, clean!) } satisfies GodChatEvent },
        };
      },
    }),
    defineTool({
      name: "glob",
      description: "Find regular text-file paths in the fixed repository snapshot. The pattern supports * within a directory, ** across directories, and ?. Results are bounded; narrow the pattern when truncated.",
      parameters: Type.Object({ pattern: Type.String() }, { additionalProperties: false }),
      replay: "safe",
      async execute(args) {
        const { paths, truncated } = deps.repo.list(args.pattern);
        const body = paths.length ? paths.join("\n") : "No files matched.";
        return {
          content: [{ type: "text", text: `${body}${truncated ? `\n[truncated: more than ${paths.length} matches; narrow the pattern]` : ""}` }],
          details: { event: { type: "step", text: `Listed files matching ${clip(args.pattern)}` } satisfies GodChatEvent },
        };
      },
    }),
    defineTool({
      name: "grep",
      description: "Search for literal text in files selected by a repository-relative glob. This is a literal substring search, not a regular expression. Narrow the glob when too many files match; results include paths and line numbers.",
      parameters: Type.Object({
        query: Type.String(),
        glob: Type.String(),
        caseSensitive: Type.Optional(Type.Boolean()),
      }, { additionalProperties: false }),
      replay: "safe",
      async execute(args) {
        const out = await deps.repo.grep(args.query, args.glob, args.caseSensitive === true);
        if ("error" in out) return failure(out.error);
        return {
          content: [{ type: "text", text: out.text }],
          details: { event: { type: "step", text: `Searched the code for “${clip(args.query)}”` } satisfies GodChatEvent },
        };
      },
    }),
  ];
}

function siteStatusTool(deps: DesignerDeps) {
  return defineTool({
    name: SITE_STATUS_TOOL.name,
    description: SITE_STATUS_TOOL.description,
    parameters: jsonSchema<unknown>(SITE_STATUS_TOOL.inputSchema),
    replay: "safe",
    async execute(args) {
      const turn = deps.turn();
      const ledger = newLedger();
      for (const view of turn?.views ?? []) ledger.views.add(view as StatusViewKey);
      for (const read of turn?.reads ?? []) ledger.reads?.add(read);
      const out = await SITE_STATUS_TOOL.run(args, deps.io, ledger);
      deps.saveTurnLedger([...ledger.views], [...(ledger.reads ?? [])]);
      return {
        content: [{ type: "text", text: out.text }],
        isError: out.isError,
        ...(out.views?.length ? { details: { event: { type: "tool", views: [...out.views] } satisfies GodChatEvent } } : {}),
      };
    },
  });
}

// 题目与计划交给访客后不立即返回模型结果：这一跑到此结束，访客的下一条消息就是答复。持久占位先于结果写入，重放走 memo 拿到同一份。
// memo 里只存可 JSON 化的领域值（挂起事件或签发过的计划），工具结果在返回时按类型重建，不靠整结果对象往返。
type PendingMemo = {
  requestId: string;
  taskId: string;
  event: { type: "ask"; questions: GodChatQuestion[] } | ({ type: "plan" } & BuildProposal);
  lead: string | null;
};
type ToolOutcome = { kind: "pending"; pending: PendingMemo } | { kind: "held" } | { kind: "error"; error: string };
type ProposalOutcome = BuildProposal | { error: string };

const outcomeResult = (outcome: ToolOutcome): ToolExecutionResult => {
  if (outcome.kind === "held") return waiting();
  if (outcome.kind === "error") return failure(outcome.error);
  return {
    content: [{ type: "text", text: outcome.pending.event.type === "ask" ? WAIT_TEXT.ask : WAIT_TEXT.plan }],
    details: { event: outcome.pending.event },
    control: { terminate: true },
  };
};

function pendingTool(deps: DesignerDeps) {
  const hold = (memo: PendingMemo): ToolOutcome => {
    const record: PendingInteraction = { requestId: memo.requestId, taskId: memo.taskId, event: memo.event, ...(memo.lead !== null && { lead: memo.lead }) };
    return deps.persistPending(record) === "conflict" ? { kind: "held" } : { kind: "pending", pending: memo };
  };
  return [
    defineTool({
      name: ASK_VISITOR_TOOL.name,
      description: ASK_VISITOR_TOOL.description,
      parameters: jsonSchema<{ questions?: unknown }>(ASK_VISITOR_TOOL.input_schema),
      replay: "safe",
      async execute(args, api, context) {
        const done = await api.memo<ToolOutcome>("result", context);
        if (done) return outcomeResult(done);
        const outcome = await (async (): Promise<ToolOutcome> => {
          const questions: GodChatQuestion[] | null = parseQuestions((args as { questions?: unknown }).questions);
          if (!questions) return { kind: "error", error: "Invalid questions. Respect the counts and length limits in the tool description, with distinct option labels." };
          const turn = deps.turn();
          if (!turn) return { kind: "error", error: "This design session has no active turn." };
          const lead = PLAN_LABELS[textLanguage(questions.map((question) => `${question.question}\n${question.options.map((option) => `${option.label} ${option.description}`).join("\n")}`).join("\n"))].askReady;
          return hold({ requestId: turn.requestId, taskId: String(api.taskId), event: { type: "ask", questions }, lead });
        })();
        return outcomeResult(await api.memo("result", outcome, context));
      },
    }),
    defineTool({
      name: PROPOSE_BUILD_TOOL.name,
      description: PROPOSE_BUILD_TOOL.description,
      parameters: jsonSchema<unknown>(PROPOSE_BUILD_TOOL.input_schema),
      replay: "safe",
      async execute(args, api, context) {
        const done = await api.memo<ToolOutcome>("result", context);
        if (done) return outcomeResult(done);
        const outcome = await (async (): Promise<ToolOutcome> => {
          const checked = checkBuildPlan(args);
          if ("error" in checked) return { kind: "error", error: `Plan rejected: ${checked.error} Fix it and call propose_build again.` };
          const turn = deps.turn();
          if (!turn) return { kind: "error", error: "This design session has no active turn." };
          // 先取回已签发的 memo 再签发：任务重放时返回的是同一份 token 与 expiresAt，不会二次签名。
          let proposal = await api.memo<ProposalOutcome>("proposal", context);
          if (proposal === undefined) {
            const issued: ProposalOutcome = await issuePlan(deps.env, checked.plan).then(
              (value) => value,
              (error: unknown) => ({ error: error instanceof Error ? error.message : "The plan could not be signed." }),
            );
            proposal = await api.memo("proposal", issued, context);
          }
          if ("error" in proposal) return { kind: "error", error: `Plan rejected: ${proposal.error}` };
          const lead = PLAN_LABELS[visitorLanguage(checked.plan)].planReady;
          return hold({ requestId: turn.requestId, taskId: String(api.taskId), event: { type: "plan", ...proposal }, lead });
        })();
        return outcomeResult(await api.memo("result", outcome, context));
      },
    }),
  ];
}

// 同一回合的工具按序跑：只要这一批调用里有题目或计划，普通工具的成功结果也请求收尾，整轮一致 terminate 才会真正停下；
// 无效的 UI 调用不 terminate，模型还能改正。若个别工具出错破了全票，预算守卫在下一次模型请求前再拦一道。
function designerHooks(deps: DesignerDeps) {
  return [
    hook(GenerationTask, {
      afterResponse: (message) => {
        const calls = message.content.filter((block): block is Extract<typeof block, { type: "toolCall" }> => block.type === "toolCall");
        deps.records.put("uibatch", JSON.stringify({ calls: calls.map((call) => ({ id: call.id, name: call.name })) }));
      },
    }),
    hook(ToolTask, {
      afterTool: (call, result) => {
        if (UI_TOOLS.has(call.name) || result.isError === true || result.control?.terminate === true) return result;
        const saved = deps.records.get("uibatch");
        const batch = saved ? JSON.parse(saved) as { calls?: { id?: unknown; name?: unknown }[] } : undefined;
        const inBatch = batch?.calls?.some((entry) => entry.id === call.id);
        const hasUi = batch?.calls?.some((entry) => typeof entry.name === "string" && UI_TOOLS.has(entry.name));
        if (inBatch && hasUi) return { ...result, control: { ...result.control, terminate: true } };
        return result;
      },
    }),
  ];
}

export function designerExtension(deps: DesignerDeps): Extension {
  return defineExtension({
    name: "god-design",
    tools: [...repositoryTools(deps), siteStatusTool(deps), ...pendingTool(deps)],
    sections: [section("planner", () => PLANNER_PROMPT, { tag: false })],
    hooks: designerHooks(deps),
  });
}

const MAX_TOKENS = GOD_CHAT_TIER_INFO.opus.maxTokens;

export async function openDesignerHarness(storage: Storage, context: Context, deps: DesignerDeps): Promise<Harness> {
  const models = createModels({
    authContext: {
      env: async (name) => (name === "ANTHROPIC_API_KEY" ? deps.anthropicKey : undefined),
      fileExists: async () => false,
    },
  });
  const base = anthropicProvider();
  const modelId = GOD_CHAT_TIER_INFO.opus.model;
  const model = base.getModels().find((entry) => entry.id === modelId);
  if (!model) throw new Error(`The planner model ${modelId} is unavailable.`);
  const { input, output, cacheRead, cacheWrite } = model.cost;
  const fetcher = designBudgetFetch({ fetcher: deps.modelFetch, store: deps.budget, model: modelId, prices: { input, output, cacheRead, cacheWrite }, limitCents: DESIGN_BUDGET_CENTS });
  const provider: Provider = {
    ...base,
    stream: (target, transcript, options) => base.stream(target as Model<"anthropic-messages">, transcript, { ...options, fetch: fetcher, maxRetries: 0, maxTokens: MAX_TOKENS } as AnthropicOptions),
    streamSimple: (target, transcript, options) => base.streamSimple(target as Model<"anthropic-messages">, transcript, { ...options, fetch: fetcher, maxRetries: 0, maxTokens: MAX_TOKENS }),
  };
  models.setProvider(provider);
  const registry = createRegistry();
  registry.install(designerExtension(deps));
  return Harness.open(storage, {
    models,
    registry,
    settings: {
      stream: { maxRetries: 0 },
      retry: { enabled: true, maxRetries: 0, baseDelayMs: 0 },
      toolExecution: "sequential",
      compaction: { enabled: true, backgroundTokens: 0 },
    },
  }, context);
}

// 给访客看的只有文字与审核过的卡片：thinking、签名与供应商错误从不投影成界面事件。
export function assistantText(message: AssistantMessage | undefined): string {
  return (message?.content ?? []).filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text").map((block) => block.text).join("");
}

const PROJECTED = new Set(["doc", "step", "tool", "ask", "plan", "text", "search"]);

export function toolResultEvent(entry: EntryRecord): GodChatEvent | null {
  if (!ToolResultEntry.is(entry)) return null;
  const message = entry.model?.[0];
  if (!message || message.role !== "toolResult") return null;
  const event = (message.details as { event?: { type?: unknown } } | undefined)?.event;
  if (!event || typeof event !== "object" || typeof event.type !== "string" || !PROJECTED.has(event.type)) return null;
  return event as GodChatEvent;
}

export function entryText(entry: EntryRecord): string | null {
  if (!AssistantEntry.is(entry)) return null;
  const message = entry.model?.[0];
  return message?.role === "assistant" ? assistantText(message) : null;
}

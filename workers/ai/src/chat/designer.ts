import type Anthropic from "@anthropic-ai/sdk";
import type { BetaManagedAgentsAgentToolset20260401Params, BetaManagedAgentsCustomToolParams } from "@anthropic-ai/sdk/resources/beta/agents/agents";
import type { BetaManagedAgentsEventParams, BetaManagedAgentsStreamSessionEvents } from "@anthropic-ai/sdk/resources/beta/sessions/events";

import { site } from "@/lib/site";
import { PLAN_LABELS, planLanguage } from "@shared/build-routine";
import { parseQuestions, type GodChatEvent, type GodChatMessage } from "@shared/god-chat";
import { GOD_CHAT_TIER_INFO } from "@shared/god-chat-tiers";

import { issuePlan } from "../build/plan";
import { checkBuildPlan } from "../build/validation";
import type { Env } from "../runtime";
import { newLedger, type ToolIO } from "../tools/registry";
import { SITE_STATUS_TOOL } from "../tools/site-status";
import { ASK_VISITOR_TOOL, DESIGN_BUDGET_CENTS, DESIGN_REPO_DIR, PLANNER_PROMPT, PROPOSE_BUILD_TOOL } from "./design";

export type SessionEvent = BetaManagedAgentsStreamSessionEvents;
export type SendEvent = BetaManagedAgentsEventParams;

const STEP_CHARS = 120;
// 补发时往回翻事件的上限：一回合规划连工具结果和计费 span 通常几十到一两百条。
const RESUME_EVENTS = 1000;
const VISITOR_REPLY = "The visitor replied:\n";

const SITE_STATUS_CUSTOM_TOOL: BetaManagedAgentsCustomToolParams = {
  type: "custom",
  name: SITE_STATUS_TOOL.name,
  description: SITE_STATUS_TOOL.replyCap ? `${SITE_STATUS_TOOL.description}\n${SITE_STATUS_TOOL.replyCap}` : SITE_STATUS_TOOL.description,
  input_schema: SITE_STATUS_TOOL.inputSchema,
};

// 访客的话能左右规划者：只读的文件工具直接放行，bash 与联网走 auto，平台判不准而停下等确认的调用 Worker 一律拒绝；
// 规划只出计划，写文件的工具不给。
const AGENT_TOOLSET: BetaManagedAgentsAgentToolset20260401Params = {
  type: "agent_toolset_20260401",
  default_config: { enabled: true, permission_policy: { type: "always_allow" } },
  configs: [
    { name: "bash", permission_policy: { type: "auto" } },
    { name: "write", enabled: false },
    { name: "edit", enabled: false },
    { name: "web_search", permission_policy: { type: "auto" } },
    { name: "web_fetch", permission_policy: { type: "auto" }, max_content_tokens: 20_000 },
  ],
};

export const DESIGNER_TOOLS = [AGENT_TOOLSET, ASK_VISITOR_TOOL, PROPOSE_BUILD_TOOL, SITE_STATUS_CUSTOM_TOOL];

export type DesignApi = {
  create(designId: string): Promise<string>;
  stream(sessionId: string, signal: AbortSignal): Promise<AsyncIterable<SessionEvent>>;
  send(sessionId: string, events: SendEvent[]): Promise<void>;
  // 会话停着等哪些自定义工具的结果：上一条回复里给访客的题目或计划。会话还在跑时返回空，访客的话按普通消息排队。
  pending(sessionId: string): Promise<string[]>;
  // 最近一回合的事件，从访客那条开场（消息或对挂起题目、计划的回答）起按时间顺序；找不到开场时为空。
  turn(sessionId: string): Promise<SessionEvent[]>;
};

export function designApi(client: Anthropic, env: Env): DesignApi {
  return {
    async create(designId) {
      const session = await client.beta.sessions.create({
        agent: {
          type: "agent_with_overrides",
          id: env.DESIGN_AGENT_ID!,
          model: { id: GOD_CHAT_TIER_INFO.opus.model, effort: GOD_CHAT_TIER_INFO.opus.effort },
          system: PLANNER_PROMPT,
          tools: DESIGNER_TOOLS,
        },
        environment_id: env.DESIGN_ENVIRONMENT_ID!,
        title: `Design ${designId.slice(0, 8)}`,
        metadata: { design: designId },
        budget: { type: "limit", max_list_cost: { amount: String(DESIGN_BUDGET_CENTS), currency: "USD" } },
      });
      return session.id;
    },
    stream: (sessionId, signal) => client.beta.sessions.events.stream(sessionId, { event_deltas: ["agent.message"] }, { signal }),
    async send(sessionId, events) {
      await client.beta.sessions.events.send(sessionId, { events });
    },
    async pending(sessionId) {
      if ((await client.beta.sessions.retrieve(sessionId)).status !== "idle") return [];
      const page = await client.beta.sessions.events.list(sessionId, { order: "desc", types: ["session.status_idle"], limit: 1 });
      const idle = page.data[0];
      return idle?.type === "session.status_idle" && idle.stop_reason.type === "requires_action" ? idle.stop_reason.event_ids : [];
    },
    async turn(sessionId) {
      const events: SessionEvent[] = [];
      for await (const event of client.beta.sessions.events.list(sessionId, { order: "desc", limit: 100 })) {
        events.push(event as SessionEvent);
        if (kickoffText(event as SessionEvent) !== null) return events.reverse();
        if (events.length >= RESUME_EVENTS) break;
      }
      return [];
    },
  };
}

// resume 不发任何东西给会话，只把访客断线时错过的那一回合重新推一遍；回合还在跑时跟着事件流看到它停下。
export type DesignTurnInput = { kind: "open"; history: GodChatMessage[] } | { kind: "reply"; text: string } | { kind: "resume" };
export type DesignTurnResult = { complete: boolean; asked: boolean; planToken?: string; lead?: string; views: string[] };

// 访客那段对话原样转给规划者，标签只用来分清说话人；内容是不可信的公开输入，系统提示词里已经说明。
export function openingBrief(history: GodChatMessage[]): string {
  const turns = history.map((message) => message.role === "user" ? `<visitor>\n${message.content}\n</visitor>` : `<assistant>\n${message.content}\n</assistant>`);
  return `The visitor opened this design session from the homepage chat. The conversation so far, oldest first; the last visitor message is the change to plan:\n\n${turns.join("\n\n")}\n\nStart planning that change now; do not ask the visitor to describe it again. Write everything the visitor sees in the language of their messages.`;
}

const userMessage = (text: string): SendEvent => ({ type: "user.message", content: [{ type: "text", text }] });

export function kickoffText(event: SessionEvent): string | null {
  if (event.type !== "user.message" && event.type !== "user.custom_tool_result") return null;
  const text = (event.content ?? []).map((block) => block.type === "text" ? block.text : "").join("");
  if (event.type === "user.message") return text;
  return text.startsWith(VISITOR_REPLY) ? text.slice(VISITOR_REPLY.length) : null;
}

// 开场里得有访客最新那条：首回合是整段转述，之后是原话。对不上说明那条消息没到会话，不能拿上一回合的回复去配它。
export function turnMatches(turn: SessionEvent[], latest: string): boolean {
  const text = turn[0] ? kickoffText(turn[0]) : null;
  return text !== null && (text === latest || text.includes(`<visitor>\n${latest}\n</visitor>`));
}

async function* replayed(backlog: SessionEvent[], live: AsyncIterable<SessionEvent>): AsyncIterable<SessionEvent> {
  const seen = new Set<string>();
  for (const event of backlog) {
    if ("id" in event) seen.add(event.id);
    yield event;
  }
  for await (const event of live) {
    const id = event.type === "event_start" ? event.event.id : event.type === "event_delta" ? event.event_id : "id" in event ? event.id : undefined;
    if (id === undefined || !seen.has(id)) yield event;
  }
}
const toolResult = (id: string, text: string, isError: boolean): SendEvent => ({ type: "user.custom_tool_result", custom_tool_use_id: id, content: [{ type: "text", text }], is_error: isError });

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > STEP_CHARS ? `${flat.slice(0, STEP_CHARS)}…` : flat;
}

export function repoBlobUrl(path: string): string {
  return `${site.repo}/blob/main/${path.split("/").map(encodeURIComponent).join("/")}`;
}

// 规划者每一步给访客看的进度：读仓库里的文件是可点的源码链接，其余是一行说明；Managed Agents 不给思考内容，没有别的可看。
export function toolProgress(name: string, input: Record<string, unknown>): GodChatEvent | null {
  const text = (key: string) => typeof input[key] === "string" ? input[key] as string : "";
  if (name === "read") {
    const file = text("file_path");
    if (file.startsWith(`${DESIGN_REPO_DIR}/`)) {
      const path = file.slice(DESIGN_REPO_DIR.length + 1);
      return { type: "doc", doc: "repo", path, url: repoBlobUrl(path) };
    }
    return file ? { type: "step", text: `Read ${clip(file)}` } : null;
  }
  if (name === "grep") return text("pattern") ? { type: "step", text: `Searched the code for “${clip(text("pattern"))}”` } : null;
  if (name === "glob") return text("pattern") ? { type: "step", text: `Listed files matching ${clip(text("pattern"))}` } : null;
  if (name === "web_search") return text("query") ? { type: "search", query: text("query") } : null;
  if (name === "web_fetch") return /^https?:\/\//.test(text("url")) ? { type: "doc", doc: "web", path: text("url"), url: text("url") } : null;
  if (name === "bash") {
    const command = text("command").replace(new RegExp(`^\\s*cd ${DESIGN_REPO_DIR}\\s*(;|&&)\\s*`), "");
    if (/git clone/.test(command)) return { type: "step", text: "Cloned the repository" };
    return command.trim() ? { type: "step", text: `Ran ${clip(command)}` } : null;
  }
  return null;
}

export async function designTurn({
  api,
  env,
  io,
  sessionId,
  input,
  emit,
  signal,
}: {
  api: DesignApi;
  env: Env;
  io: ToolIO;
  sessionId: string;
  input: DesignTurnInput;
  emit: (event: GodChatEvent) => void;
  signal: AbortSignal;
}): Promise<DesignTurnResult> {
  const local = new AbortController();
  const stop = () => local.abort();
  signal.addEventListener("abort", stop, { once: true });
  const ledger = newLedger();
  // 交给访客回答的题目和计划不立刻回结果：会话停在等结果的状态，访客下一条消息就是这次调用的结果。
  const held = new Set<string>();
  const shown = new Map<string, string>();
  const observe = input.kind === "resume";
  // 补发时题目和计划等会话停下、确认还挂着再推：原回合可能已经把无效的调用退回给规划者。
  const parked = new Map<string, { name: string; input: unknown }>();
  let wroteText = false;
  let asked = false;
  let planToken: string | undefined;
  let lead: string | undefined;
  let complete = true;
  const usage = { requests: 0, input: 0, output: 0, cacheRead: 0 };
  let stopReason = "unknown";

  const beginText = (id: string) => {
    if (shown.has(id)) return;
    if (wroteText) emit({ type: "text", text: "\n\n" });
    shown.set(id, "");
  };
  const appendText = (id: string, chunk: string) => {
    beginText(id);
    if (!chunk) return;
    shown.set(id, shown.get(id)! + chunk);
    wroteText = true;
    emit({ type: "text", text: chunk });
  };
  // 实时片段只保证是最终文字的前缀，可能半路被丢：以缓冲到的整段为准，补上没推过的后缀。
  const finishText = (id: string, full: string) => {
    const sofar = shown.get(id) ?? "";
    if (!full.startsWith(sofar)) return;
    appendText(id, full.slice(sofar.length));
  };

  const custom = async (id: string, name: string, toolInput: unknown): Promise<SendEvent | null> => {
    if (name === SITE_STATUS_TOOL.name) {
      const { text, isError, views } = await SITE_STATUS_TOOL.run(toolInput, io, ledger);
      if (views) emit({ type: "tool", views });
      return toolResult(id, text, isError);
    }
    if (name === ASK_VISITOR_TOOL.name) {
      if (asked || planToken) return toolResult(id, "Something is already waiting for the visitor in this reply. End the reply now.", true);
      const questions = parseQuestions((toolInput as { questions?: unknown } | null)?.questions);
      if (!questions) return toolResult(id, "Invalid questions. Respect the counts and length limits in the tool description, with distinct option labels.", true);
      asked = true;
      held.add(id);
      lead = PLAN_LABELS[planLanguage({ title: "", spec: questions.map((question) => `${question.question}\n${question.options.map((option) => `${option.label} ${option.description}`).join("\n")}`).join("\n"), acceptance: [] })].askReady;
      emit({ type: "ask", questions });
      return null;
    }
    if (name === PROPOSE_BUILD_TOOL.name) {
      if (asked || planToken) return toolResult(id, "Something is already waiting for the visitor in this reply. End the reply now.", true);
      const checked = checkBuildPlan(toolInput);
      if ("error" in checked) return toolResult(id, `Plan rejected: ${checked.error} Fix it and call propose_build again.`, true);
      const proposal = await issuePlan(env, checked.plan).catch((error: unknown) => error instanceof Error ? error : new Error("The plan could not be signed."));
      if (proposal instanceof Error) return toolResult(id, `Plan rejected: ${proposal.message}`, true);
      held.add(id);
      planToken = proposal.token;
      lead = PLAN_LABELS[planLanguage(checked.plan)].planReady;
      emit({ type: "plan", ...proposal });
      return null;
    }
    return toolResult(id, "Unknown tool.", true);
  };

  try {
    // 先开事件流再翻历史，两段之间产生的事件不会漏，重复的按事件 ID 去掉。
    const live = await api.stream(sessionId, local.signal);
    let events: AsyncIterable<SessionEvent> = live;
    if (input.kind === "resume") events = replayed((await api.turn(sessionId)).slice(1), live);
    else {
      let kickoff: SendEvent[];
      if (input.kind === "open") kickoff = [userMessage(openingBrief(input.history))];
      else {
        const pending = await api.pending(sessionId);
        kickoff = pending.length
          ? pending.map((id, i) => toolResult(id, i === 0 ? `${VISITOR_REPLY}${input.text}` : "Superseded by the visitor's reply to your other request.", false))
          : [userMessage(input.text)];
      }
      await api.send(sessionId, kickoff);
    }

    loop: for await (const event of events) {
      switch (event.type) {
        case "event_start":
          if (event.event.type === "agent.message") beginText(event.event.id);
          break;
        case "event_delta":
          appendText(event.event_id, event.delta.content.text);
          break;
        case "agent.message":
          finishText(event.id, event.content.map((block) => block.type === "text" ? block.text : "").join(""));
          break;
        case "agent.tool_use":
        case "agent.mcp_tool_use": {
          if (event.type === "agent.tool_use") {
            const progress = toolProgress(event.name, event.input);
            if (progress) emit(progress);
          }
          if (event.evaluated_permission === "ask" && !observe) {
            await api.send(sessionId, [{ type: "user.tool_confirmation", tool_use_id: event.id, result: "deny", deny_message: "Denied: nobody can confirm tool calls in this session. Work with read-only commands." }]);
          }
          break;
        }
        case "agent.custom_tool_use": {
          if (observe) {
            parked.set(event.id, { name: event.name, input: event.input });
            break;
          }
          const reply = await custom(event.id, event.name, event.input);
          if (reply) await api.send(sessionId, [reply]);
          break;
        }
        case "span.model_request_end":
          usage.requests += 1;
          usage.input += event.model_usage?.input_tokens ?? 0;
          usage.output += event.model_usage?.output_tokens ?? 0;
          usage.cacheRead += event.model_usage?.cache_read_input_tokens ?? 0;
          break;
        case "session.error":
          console.error("[god-chat] design session error", JSON.stringify({ sessionId, error: event.error?.type }));
          break;
        case "session.status_idle": {
          const reason = event.stop_reason;
          stopReason = reason.type;
          if (reason.type === "requires_action") {
            if (observe && reason.event_ids.every((id) => parked.get(id)?.name === ASK_VISITOR_TOOL.name || parked.get(id)?.name === PROPOSE_BUILD_TOOL.name)) {
              for (const id of reason.event_ids) await custom(id, parked.get(id)!.name, parked.get(id)!.input);
            }
            if (reason.event_ids.every((id) => held.has(id))) break loop;
            break;
          }
          if (reason.type === "budget_reached") emit({ type: "text", text: "\n\n(This design session has used its budget. Continue in ordinary chat.)" });
          else if (reason.type !== "end_turn") {
            complete = false;
            emit({ type: "text", text: "\n\n[The planner stopped unexpectedly. Send another message to try again.]" });
          }
          break loop;
        }
        case "session.status_terminated":
          stopReason = "terminated";
          complete = false;
          emit({ type: "text", text: "\n\n[This design session has ended. Continue in ordinary chat.]" });
          break loop;
      }
    }
  } catch (error) {
    if (signal.aborted && !observe) {
      await api.send(sessionId, [{ type: "user.interrupt" }]).catch(() => {});
      throw error;
    }
    throw error;
  } finally {
    signal.removeEventListener("abort", stop);
    local.abort();
    console.info("[god-chat] design turn", JSON.stringify({ sessionId, kind: input.kind, stopReason, asked, plan: Boolean(planToken), ...usage }));
  }
  return { complete, asked, views: [...ledger.views], ...(planToken && { planToken }), ...(lead && { lead }) };
}

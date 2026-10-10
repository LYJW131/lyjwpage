import { Agent, type AgentEvent, type AgentMessage, type AgentTool, type AgentToolResult } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { Type } from "typebox";

import { parseQuestions, type GodChatQuestion } from "@shared/god-chat";
import type { BuildProposal } from "@shared/build-routine";

import { DESIGN_READ_LIMITS } from "../src/chat/design";
import { findRepoFiles, parseFindInput, parseRepoFileInput, readRepoFile, REPO_FILE_LIMITS, type RepoTree } from "../src/chat/repo-file";
import { newLedger, SITE_TOOLS, type ToolIO } from "../src/tools/registry";
import { DESIGN_TOOLS, PATHS, TURN_LIMITS } from "./contract";

const REPLAY = "我想要在提issue或者build那里 连接GitHub之前 先让用户同意一份隐私条款 告诉他们授权GitHub的作用";
const TREE_URL = "https://api.github.com/repos/LYJW131/lyjwpage/git/trees/main?recursive=1";
const DB = "design-harness";
const STORE = "sessions";

type Saved = { id: string; designToken: string; expiresAt: number; messages: AgentMessage[]; savedAt: number };
type Metrics = {
  startedAt: number;
  ticketMs?: number;
  firstToolMs?: number;
  firstToolName?: string;
  cardMs?: number;
  card?: string;
  requests: number;
  requestsUntilCard?: number;
  tools: string[];
  wrongPaths: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  endedAt?: number;
  error?: string;
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = $("log");
const metricsBox = $("metrics");

function line(kind: string, text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `line ${kind}`;
  el.textContent = text;
  log.appendChild(el);
  el.scrollIntoView({ block: "end" });
  return el;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function saveSession(value: Saved): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value);
    tx.oncomplete = tx.onerror = () => resolve();
  });
}

async function latestSession(): Promise<Saved | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const request = db.transaction(STORE).objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result as Saved[]).sort((a, b) => b.savedAt - a.savedAt)[0] ?? null);
    request.onerror = () => resolve(null);
  });
}

let treeCache: string[] | null = null;
const browserTree: RepoTree = async () => {
  if (treeCache) return treeCache;
  try {
    const response = await fetch(TREE_URL, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) return null;
    const data = await response.json() as { tree?: { path?: unknown; type?: unknown }[] };
    treeCache = (data.tree ?? []).flatMap((entry) => entry.type === "blob" && typeof entry.path === "string" ? [entry.path] : []);
    return treeCache.length ? treeCache : null;
  } catch {
    return null;
  }
};

const io: ToolIO = {
  readStatus: (path) => fetch(`${PATHS.status}${path}`),
  readDoc: (url) => fetch(url),
};

const ok = (text: string, extra: Partial<AgentToolResult<unknown>> = {}): AgentToolResult<unknown> => ({ content: [{ type: "text", text }], details: undefined, ...extra });
const fail = (text: string): AgentToolResult<unknown> => ok(text, { isError: true });

let ticket = "";
let metrics: Metrics | null = null;
let replyState = { ledger: newLedger(), finds: 0, reads: 0, asked: false, planned: false };

function renderQuestions(questions: GodChatQuestion[], send: (text: string) => void) {
  const card = document.createElement("div");
  card.className = "card";
  const picks = new Map<number, Set<string>>();
  questions.forEach((question, index) => {
    const block = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = `${question.header}: ${question.question}`;
    block.appendChild(legend);
    picks.set(index, new Set());
    for (const option of question.options) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = question.multiSelect ? "checkbox" : "radio";
      input.name = `q${index}`;
      input.onchange = () => {
        const set = picks.get(index)!;
        if (!question.multiSelect) set.clear();
        if (input.checked) set.add(option.label); else set.delete(option.label);
      };
      label.appendChild(input);
      label.appendChild(document.createTextNode(` ${option.label} — ${option.description}`));
      block.appendChild(label);
    }
    card.appendChild(block);
  });
  const button = document.createElement("button");
  button.textContent = "Send answers";
  button.onclick = () => send(questions.map((question, index) => `${question.question}\n→ ${[...picks.get(index)!].join(", ") || "(no choice)"}`).join("\n\n"));
  card.appendChild(button);
  log.appendChild(card);
  card.scrollIntoView({ block: "end" });
}

function renderPlan(proposal: BuildProposal) {
  const card = document.createElement("div");
  card.className = "card";
  card.textContent = `Plan: ${proposal.plan.title}\n\nPaths:\n${proposal.plan.paths.join("\n")}\n\nAcceptance:\n${proposal.plan.acceptance.map((item) => `- ${item}`).join("\n")}\n\nSigned token: ${proposal.token.length} chars, expires ${new Date(proposal.expiresAt).toLocaleTimeString("en-US")}`;
  log.appendChild(card);
}

function tools(send: (text: string) => void): AgentTool[] {
  return DESIGN_TOOLS.map((definition) => ({
    name: definition.name,
    label: definition.name,
    description: definition.description ?? "",
    parameters: Type.Unsafe(definition.input_schema as Record<string, unknown>),
    async execute(_id, params) {
      const input = params as unknown;
      if (definition.name === "find_repo_files") {
        const terms = parseFindInput(input);
        if (!terms) return fail('Invalid query. Give one or more path fragments, such as "plan card".');
        if (replyState.finds >= REPO_FILE_LIMITS.findsPerReply) return fail(`Not searched, this reply may search at most ${REPO_FILE_LIMITS.findsPerReply} times.`);
        replyState.finds += 1;
        const result = await findRepoFiles(browserTree, terms);
        return result.ok ? ok(result.text) : fail(result.text);
      }
      if (definition.name === "read_repo_file") {
        const request = parseRepoFileInput(input);
        if (!request) return fail("Invalid path. Give a repository-relative file path such as workers/ai/src/chat/handler.ts.");
        if (replyState.reads >= REPO_FILE_LIMITS.readsPerReply) return fail(`Not read, this reply may read at most ${REPO_FILE_LIMITS.readsPerReply} files or ranges.`);
        const result = await readRepoFile(io.readDoc, request, browserTree);
        if (result.ok) replyState.reads += 1;
        else if (metrics && result.text.includes("No such file")) metrics.wrongPaths += 1;
        return result.ok ? ok(result.text) : fail(result.text);
      }
      if (definition.name === "ask_visitor") {
        if (replyState.asked) return fail("Questions were already shown in this reply.");
        const questions = parseQuestions((input as { questions?: unknown } | null)?.questions);
        if (!questions) return fail("Invalid questions. Respect the counts and length limits in the tool description, with distinct option labels.");
        replyState.asked = true;
        renderQuestions(questions, send);
        return ok("The questions are shown as clickable choices. End the reply now; the visitor's next message carries the answers.", { terminate: true });
      }
      if (definition.name === "propose_build") {
        if (replyState.planned) return fail("A plan was already proposed in this reply.");
        const response = await fetch(PATHS.plan, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket, plan: input }) });
        const body = await response.json() as BuildProposal | { error: string };
        if ("error" in body) return fail(body.error);
        replyState.planned = true;
        renderPlan(body);
        return ok("The plan is displayed. The visitor can choose Open issue or Start build; nothing has been submitted.", { terminate: true });
      }
      const tool = SITE_TOOLS.find((candidate) => candidate.name === definition.name);
      if (!tool) return fail("Unknown tool.");
      const outcome = await tool.run(input, io, replyState.ledger);
      return outcome.isError ? fail(outcome.text) : ok(outcome.text);
    },
  }));
}

function showMetrics() {
  if (!metrics) return;
  const m = metrics;
  const s = (ms?: number) => ms === undefined ? "n/a" : `${(ms / 1000).toFixed(1)}s`;
  metricsBox.textContent = [
    `run ticket: ${s(m.ticketMs)}`,
    `first tool call: ${s(m.firstToolMs)} (${m.firstToolName ?? "none"})`,
    `card: ${m.card ?? "none"} at ${s(m.cardMs)}, model requests until card: ${m.requestsUntilCard ?? "n/a"}`,
    `model requests: ${m.requests}  tools: ${m.tools.join(", ") || "none"}`,
    `wrong paths: ${m.wrongPaths}`,
    `tokens in=${m.input} out=${m.output} cacheRead=${m.cacheRead} cacheWrite=${m.cacheWrite}`,
    `estimated cost: $${m.costUsd.toFixed(4)}`,
    `total: ${s(m.endedAt === undefined ? undefined : m.endedAt - m.startedAt)}`,
    m.error ? `error: ${m.error}` : "",
  ].filter(Boolean).join("\n");
  (window as unknown as { __metrics: Metrics }).__metrics = m;
}

async function main() {
  const models = createModels();
  models.setProvider(anthropicProvider());
  const base = models.getModel("anthropic", "claude-opus-5-5") as Model<"anthropic-messages">;
  const model: Model<"anthropic-messages"> = {
    ...base,
    baseUrl: `${location.origin}${PATHS.llmBase}`,
    compat: { ...base.compat, supportsMidConvoEffort: false, supportsMidConvoSystemMessages: false, supportsMidConvoToolChanges: false },
  };

  let session: Saved | null = await latestSession();
  if (session && session.expiresAt < Date.now()) session = null;
  let agent: Agent;
  let streaming: HTMLElement | null = null;
  let thinking: HTMLElement | null = null;

  const send = (text: string) => void run(text);

  function build(messages: AgentMessage[]) {
    agent = new Agent({
      initialState: { systemPrompt: "Planner prompt is injected by the proxy.", model, thinkingLevel: "medium", tools: tools(send), messages },
      streamFn: (m, context, options) => models.streamSimple(m, context, { ...options, apiKey: ticket }),
      toolExecution: "parallel",
      finishTurn: () => metrics && metrics.requests >= TURN_LIMITS.requests ? { action: "end" } : undefined,
    });
    agent.subscribe(onEvent);
  }

  function onEvent(event: AgentEvent) {
    const m = metrics;
    if (!m) return;
    const now = performance.now();
    if (event.type === "message_start" && event.message.role === "assistant") {
      m.requests += 1;
      streaming = null;
      thinking = null;
    } else if (event.type === "message_update") {
      const update = event.assistantMessageEvent;
      if (update.type === "text_delta") (streaming ??= line("text", "")).textContent += update.delta;
      if (update.type === "thinking_delta") (thinking ??= line("thinking", "")).textContent += update.delta;
    } else if (event.type === "message_end" && event.message.role === "assistant") {
      const message = event.message as AssistantMessage;
      m.input += message.usage.input;
      m.output += message.usage.output;
      m.cacheRead += message.usage.cacheRead;
      m.cacheWrite += message.usage.cacheWrite;
      m.costUsd += message.usage.cost.total;
      if (message.stopReason === "error" || message.stopReason === "aborted") m.error = message.errorMessage;
    } else if (event.type === "tool_execution_start") {
      if (m.firstToolMs === undefined) {
        m.firstToolMs = now - m.startedAt;
        m.firstToolName = event.toolName;
      }
      m.tools.push(event.toolName);
      if (!m.card && (event.toolName === "ask_visitor" || event.toolName === "propose_build")) {
        m.card = event.toolName;
        m.cardMs = now - m.startedAt;
        m.requestsUntilCard = m.requests;
      }
      line("tool", `→ ${event.toolName} ${JSON.stringify(event.args).slice(0, 160)}`);
    } else if (event.type === "tool_execution_end") {
      line(event.isError ? "tool error" : "tool", `← ${event.toolName}${event.isError ? " (error)" : ""} ${event.durationMs ?? 0}ms`);
    } else if (event.type === "agent_end") {
      m.endedAt = now;
      if (session) void saveSession({ ...session, messages: agent.state.messages, savedAt: Date.now() });
    }
    showMetrics();
  }

  async function ensureSession(): Promise<Saved | null> {
    if (session) return session;
    const response = await fetch(PATHS.start, { method: "POST" });
    const body = await response.json() as { token?: string; expiresAt?: number; error?: string };
    if (!body.token || !body.expiresAt) {
      line("error", `Could not start a design session: ${body.error ?? response.status}`);
      return null;
    }
    session = { id: crypto.randomUUID(), designToken: body.token, expiresAt: body.expiresAt, messages: [], savedAt: Date.now() };
    build([]);
    return session;
  }

  async function run(text: string) {
    if (agent?.state.isStreaming) return;
    const started = await ensureSession();
    if (!started) return;
    metrics = { startedAt: performance.now(), requests: 0, tools: [], wrongPaths: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };
    replyState = { ledger: newLedger(), finds: 0, reads: 0, asked: false, planned: false };
    replyState.ledger.docLimit = DESIGN_READ_LIMITS.docs;
    line("user", text);
    const response = await fetch(PATHS.turn, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ designToken: started.designToken }) });
    const body = await response.json() as { ticket?: string; error?: string };
    if (!body.ticket) {
      line("error", body.error ?? `HTTP ${response.status}`);
      return;
    }
    ticket = body.ticket;
    metrics.ticketMs = performance.now() - metrics.startedAt;
    await agent.prompt(text);
    console.info("[harness] metrics", JSON.stringify(metrics));
  }

  build(session?.messages ?? []);
  if (session) line("note", `Resumed design session ${session.id} with ${session.messages.length} stored messages.`);

  $("send").onclick = () => {
    const input = $<HTMLTextAreaElement>("input");
    const value = input.value.trim();
    if (value) send(value);
  };
  $("replay").onclick = () => send(REPLAY);
  $("stop").onclick = () => agent.abort();
  $("reset").onclick = () => {
    session = null;
    log.textContent = "";
    metricsBox.textContent = "";
    build([]);
  };
  $<HTMLTextAreaElement>("input").value = REPLAY;
}

void main();

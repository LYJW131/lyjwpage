#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { JUDGE_SCHEMA, VERIFIER_SCHEMA } from "./verify-action/report.ts";
import { childEnv, filterGrepOutput, inside, prepareInside, quote, readAllowed, realInside, sandboxed, writeInside } from "./verify-agent/guard.ts";
import { installOidcAnthropicProvider, loadAnthropicOidcSdk, resolveVerifyAuth } from "./verify-agent/oidc.ts";
import { PLAYBOOK } from "./verify-agent/playbook.ts";
import { claimsTool, compareBaseTool, docsSyncTool, prDiffTool, runTestsTool, type Claim } from "./verify-agent/tools.ts";

const HELP = `用法：node scripts/verify-agent.ts --role verifier|judge --prompt-file FILE [选项]
用 pi（@earendil-works/pi-coding-agent 的 SDK）跑 Verify Action 的验证员 / 判定员。模型走 Anthropic API：
CI 里走 GitHub OIDC 联合认证（--oidc-request-file + --federation-rule-id / --organization-id），本地可用 --api-key-file 或 ANTHROPIC_API_KEY。
结构化结果写进 GITHUB_OUTPUT 的 structured_output（没有就打印），用量与耗时写进 usage 与 GITHUB_STEP_SUMMARY。退出码 0 交了结果、1 没交或出错、2 参数错。

  --role verifier|judge      决定结果 schema 与可写目录
  --prompt-file FILE         任务提示词（verify-action.ts prompt 的输出）；省略时读环境变量 PROMPT
  --model PROVIDER/ID        默认 anthropic/claude-haiku-5-5；静态钥匙的环境变量按提供方取（ANTHROPIC_API_KEY、DEEPSEEK_API_KEY…）
  --thinking LEVEL           off|minimal|low|medium|high|xhigh|max，默认 high
  --out-dir DIR              验证员可写的产物目录（shots/、work/），judge 不写
  --base REF                 pr_diff 工具比对的目标分支，默认 origin/main
  --pr N                     pr_view 工具读的 PR；读 GitHub 用 GITHUB_TOKEN（只留在本进程，不进 bash）
  --timeout-min N            整轮上限，默认 20
  --transcript FILE          把整轮事件写成 JSONL，复盘用
  --oidc-request-file FILE   从文件读 GitHub OIDC 请求凭据（{"url","token"}）并删掉文件（CI 走 OIDC 时必须这样传）
  --federation-rule-id ID    Anthropic Workload Identity Federation 规则 ID（可由 ANTHROPIC_FEDERATION_RULE_ID 提供）
  --organization-id ID       Anthropic 组织 ID（可由 ANTHROPIC_ORGANIZATION_ID 提供）
  --service-account-id ID    Anthropic 服务账号 ID（可选，可由 ANTHROPIC_SERVICE_ACCOUNT_ID 提供）
  --workspace-id ID          Anthropic 工作空间 ID（可选，可由 ANTHROPIC_WORKSPACE_ID 提供）
  --api-key-file FILE        从文件读静态 API 钥匙并删掉文件；本地可用 ANTHROPIC_API_KEY（不走 OIDC 时）
  --github-token-file FILE   同上，给 pr_view 的 GitHub 令牌；本地可用 GITHUB_TOKEN
  --pi-sdk DIR               装了 pi SDK 的 node_modules 目录；默认依次试 PI_SDK_DIR（npm install --prefix 的目录）、npm 全局目录`;

const OPTIONS = {
  role: { type: "string" },
  "prompt-file": { type: "string" },
  model: { type: "string", default: "anthropic/claude-haiku-5-5" },
  thinking: { type: "string", default: "high" },
  "out-dir": { type: "string" },
  base: { type: "string", default: "origin/main" },
  pr: { type: "string" },
  "timeout-min": { type: "string", default: "20" },
  transcript: { type: "string" },
  "pi-sdk": { type: "string" },
  "oidc-request-file": { type: "string" },
  "federation-rule-id": { type: "string" },
  "organization-id": { type: "string" },
  "service-account-id": { type: "string" },
  "workspace-id": { type: "string" },
  "api-key-file": { type: "string" },
  "github-token-file": { type: "string" },
  help: { type: "boolean" },
} as const;

const { values } = (() => {
  try {
    return parseArgs({ strict: true, options: OPTIONS });
  } catch (caught) {
    console.error(`${(caught as Error).message}\n\n${HELP}`);
    process.exit(2);
  }
})();
if (values.help) {
  console.log(HELP);
  process.exit(0);
}
const FOLLOW_UP_MS = 5 * 60_000;
const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
if (!THINKING.includes(values.thinking)) {
  console.error(`--thinking 只认 ${THINKING.join("|")}`);
  process.exit(2);
}
const role = values.role;
if (role !== "verifier" && role !== "judge") {
  console.error(HELP);
  process.exit(2);
}
const promptInput = values["prompt-file"] ? fs.readFileSync(values["prompt-file"], "utf8") : process.env.PROMPT;
if (!promptInput) {
  console.error("没有提示词：给 --prompt-file 或环境变量 PROMPT");
  process.exit(2);
}
let prompt: string = promptInput;
const timeoutMin = Number(values["timeout-min"]);
if (!(timeoutMin > 0)) {
  console.error("--timeout-min 要正数");
  process.exit(2);
}

const [provider, modelId] = values.model.includes("/") ? [values.model.slice(0, values.model.indexOf("/")), values.model.slice(values.model.indexOf("/") + 1)] : ["anthropic", values.model];
const { oidc: oidcConfig, apiKey, githubToken } = (() => {
  try {
    return resolveVerifyAuth({
      provider,
      oidcRequestFile: values["oidc-request-file"],
      federationRuleId: values["federation-rule-id"],
      organizationId: values["organization-id"],
      serviceAccountId: values["service-account-id"],
      workspaceId: values["workspace-id"],
      apiKeyFile: values["api-key-file"],
      githubTokenFile: values["github-token-file"],
    });
  } catch (caught) {
    console.error(caught instanceof Error ? caught.message : String(caught));
    process.exit(2);
  }
})();

const cwd = process.cwd();
const SKILL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "verify-agent", "skills");
const outDir = values["out-dir"] ? path.resolve(values["out-dir"]) : null;
// bwrap 的 --bind 要求源目录已存在
if (outDir) fs.mkdirSync(outDir, { recursive: true });
if (outDir && fs.lstatSync(outDir).isSymbolicLink()) throw new Error(`${outDir} 是符号链接，写守卫会跟着它解析到外面`);
const tmpDir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? process.env.TMPDIR ?? "/tmp", "verify-agent-"));
// pi 自己的状态（模型表、凭据表、agentDir）不放进沙箱可写的 tmpDir：PR 代码改了模型表的 baseUrl，钥匙就跟着请求发到别处
const piStateDir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? process.env.TMPDIR ?? "/tmp", "verify-pi-state-"));
const schema = role === "verifier" ? VERIFIER_SCHEMA : JUDGE_SCHEMA;

const childEnvNow = () => childEnv(process.env, tmpDir);
const bwrap = process.platform === "linux" && spawnSync("bwrap", ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--unshare-pid", "--die-with-parent", "true"]).status === 0;
// 没有 PID 命名空间时，Linux 上的子进程能读本进程的 /proc/<pid>/environ 拿到钥匙：CI 里宁可不跑
if (process.platform === "linux" && process.env.CI && !bwrap) {
  console.error("CI 里 bwrap 起不来，不跑验证员（bash 子进程会读到 API 钥匙）");
  process.exit(1);
}
const writable = [cwd, tmpDir, ...(outDir ? [outDir] : [])];
const wrap = (command: string) => sandboxed(command, writable, bwrap);

const { sdk, sdkDir } = await loadPi(values["pi-sdk"]);
const readRoots = [cwd, tmpDir, sdkDir, SKILL_DIR, ...(outDir ? [outDir] : [])];
// 守卫要和内置工具算出同一个路径（它们会去掉 @ 前缀、展开 ~）：直接用 pi 自己的解析函数，不另写一份
const piPaths: { resolveToCwd: (file: string, cwd: string) => string; resolveReadPathAsync: (file: string, cwd: string) => Promise<string> } = await import(
  pathToFileURL(path.join(sdkDir, "dist/core/tools/path-utils.js")).href
);
const { createAgentSession, createBashToolDefinition, createWriteToolDefinition, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = sdk;

const modelRuntime = await ModelRuntime.create({ authPath: path.join(piStateDir, "auth.json"), modelsPath: path.join(piStateDir, "models.json") });
if (oidcConfig) {
  const oidcSdk = await loadAnthropicOidcSdk(sdkDir);
  installOidcAnthropicProvider(modelRuntime, oidcConfig, oidcSdk);
} else {
  await modelRuntime.setRuntimeApiKey(provider, apiKey!);
}
const model = modelRuntime.getModel(provider, modelId);
if (!model) throw new Error(`pi 的模型表里没有 ${provider}/${modelId}`);
// DeepSeek 的强度走 reasoning_effort（low / high / max），pi 按 baseUrl 也会探测出来；写明，免得升级后探测规则变了悄悄不发
if (provider === "deepseek") model.compat = { ...model.compat, supportsReasoningEffort: true };

let report: unknown = null;
let effortSent: string | undefined;
const workLog = (name: string, text: string) => {
  if (!outDir) return null;
  const file = path.join(outDir, "work", name);
  writeInside(outDir, file, text);
  return file;
};
const text = (body: string) => ({ content: [{ type: "text" as const, text: body }], details: undefined });

const run = (command: string, timeoutMs: number, dir = cwd) =>
  new Promise<{ code: string | number; output: string }>((resolve) => {
    const child = spawn("bash", ["-c", wrap(command)], { cwd: dir, env: childEnvNow() as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"], signal: AbortSignal.timeout(timeoutMs) });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (caught) => (output += `\n${caught.message}`));
    child.on("close", (code, signal) => resolve({ code: code ?? `signal ${signal}`, output }));
  });

const git = (args: string[], dir = cwd) =>
  execFileSync("bash", ["-c", wrap(["git", ...args].map(quote).join(" "))], { cwd: dir, env: childEnvNow() as NodeJS.ProcessEnv, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const bash = createBashToolDefinition(cwd, {
  exposeSessionEnvironment: false,
  spawnHook: ({ command, cwd: dir, env }: { command: string; cwd: string; env: Record<string, string | undefined> }) => ({ command: wrap(command), cwd: dir, env: { ...childEnvNow(), PATH: env.PATH ?? process.env.PATH } }),
});

const write = createWriteToolDefinition(cwd);
const guardedWrite = {
  ...write,
  description: `${write.description}\n只能写进 ${outDir ?? "（本角色不许写文件）"}。`,
  execute: (id: string, params: { path: string }, ...rest: unknown[]) => {
    const target = piPaths.resolveToCwd(params.path, cwd);
    if (!outDir || !realInside(outDir, target)) throw new Error(`只许写进 ${outDir ?? "（不许写）"}：${target}`);
    return (write.execute as (...args: unknown[]) => unknown)(id, params, ...rest);
  },
};

const claims = new Map<string, Claim>();
const toolContext = { cwd, base: values.base, tmpDir, run, git, workLog };

const customTools = [
  bash,
  ...(outDir ? [guardedWrite] : []),
  prDiffTool(toolContext),
  runTestsTool(toolContext),
  ...(role === "verifier" && values.pr && githubToken
    ? [
        {
          name: "pr_view",
          label: "PR view",
          description: "读这个 PR 的标题、描述、标签、head 与目标分支（GitHub API，只读）。bash 里没有 GitHub 令牌，gh 用不了，查 PR 用这个。",
          parameters: { type: "object", properties: {} },
          execute: async () => {
            const pull = await fetchPull();
            return text(JSON.stringify({ title: pull.title, labels: pull.labels.map((label) => label.name), head: pull.head.sha, base: pull.base.ref, body: pull.body ?? "" }, null, 2));
          },
        },
      ]
    : []),
  docsSyncTool(toolContext),
  compareBaseTool(toolContext),
  claimsTool(claims),
  {
    name: "submit_report",
    label: "Submit report",
    description: "交最终结果，整轮到此结束。参数照结果 schema；只调一次，调之前把要跑的检查都跑完。",
    parameters: schema,
    execute: async (_id: string, params: unknown) => {
      report = params;
      return { ...text("已收到结果。"), terminate: true };
    },
  },
];

const SYSTEM = `你在 pi 里运行，工具和 Claude Code 不同：
- read / grep / find / ls：读文件与搜索（只读），只许读工作区、产物目录、临时目录与 pi 的 SDK 目录，以及 skill 目录 ${SKILL_DIR}；别处的文件用 bash 读。bash：跑命令，环境里没有任何令牌与密钥，GitHub CLI 用不了；${bwrap ? "已在 bubblewrap 沙箱里，只许写工作目录、$TMPDIR 与产物目录，" : ""}没有 WebFetch，读公开网页用 curl。
- pr_diff：看这次改动，先 stat=true 看全貌再按文件看。run_tests：跑单测当证据，别自己拼 node --test 命令。${role === "verifier" && values.pr && githubToken ? "pr_view：读 PR 描述与标签。" : ""}${outDir ? `write：只能写进 ${outDir}。` : ""}
- 你的模型 ID 是 ${modelId}，结果里的 model 字段照写。
- 互不依赖的读与搜索在同一轮里并行调用。提示词里说「按给定的 JSON schema 交结果」，就是调用 submit_report 工具；不调它这一轮就算没交。
- claims：登记要核对的声明。compare_base：同一条命令在 HEAD 与目标分支上各跑一次对照。docs_sync：查改了的说法在文档里有没有跟着改。${role === "verifier" ? `\n\n${PLAYBOOK}` : ""}`;

const resourceLoader = new DefaultResourceLoader({
  cwd,
  agentDir: piStateDir,
  noExtensions: true,
  additionalSkillPaths: [SKILL_DIR],
  skillsOverride: (base: { skills: { filePath: string }[]; diagnostics: unknown[] }) => ({ ...base, skills: base.skills.filter((skill) => skill.filePath.startsWith(SKILL_DIR)) }),
  noPromptTemplates: true,
  noThemes: true,
  appendSystemPrompt: [SYSTEM],
  extensionFactories: [
    {
      name: "verify-guard",
      factory: (pi: { on: (event: string, handler: (event: { toolName: string; input: Record<string, unknown>; content?: { type: string; text?: string }[] }) => unknown) => void }) => {
        pi.on("before_provider_request", (event) => {
          const payload = (event as unknown as { payload?: Record<string, unknown> }).payload ?? {};
          effortSent ??= JSON.stringify({ reasoning_effort: payload.reasoning_effort, thinking: payload.thinking, output_config: payload.output_config });
          return undefined;
        });
        pi.on("tool_result", (event) => {
          if (event.toolName !== "grep") return undefined;
          const raw = typeof event.input.path === "string" && event.input.path ? event.input.path : ".";
          const dir = piPaths.resolveToCwd(raw, cwd);
          const content = (event.content ?? []).map((part) => (part.type === "text" ? { ...part, text: filterGrepOutput(part.text ?? "", dir).text } : part));
          return { content, structuredContent: undefined };
        });
        pi.on("tool_call", async (event) => {
          if (!["read", "grep", "find", "ls"].includes(event.toolName)) return undefined;
          const raw = typeof event.input.path === "string" && event.input.path ? event.input.path : ".";
          const target = event.toolName === "read" ? await piPaths.resolveReadPathAsync(raw, cwd) : piPaths.resolveToCwd(raw, cwd);
          if (!readAllowed(readRoots, target)) return { block: true, reason: `只许读 ${readRoots.join("、")}（/proc、gh 凭据与 .env* 除外）：${target}` };
          return undefined;
        });
      },
    },
  ],
});
await resourceLoader.reload();

const { session } = await createAgentSession({
  cwd,
  agentDir: piStateDir,
  model,
  thinkingLevel: values.thinking,
  modelRuntime,
  resourceLoader,
  tools: ["read", "grep", "find", "ls", "bash", ...(outDir ? ["write"] : []), "pr_diff", "run_tests", ...(role === "verifier" ? ["pr_view"] : []), "docs_sync", "compare_base", "claims", "submit_report"],
  customTools,
  sessionManager: SessionManager.inMemory(cwd),
  settingsManager: SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: true, maxRetries: 3 } }),
});

if (values.transcript) prepareInside(outDir && inside(outDir, path.resolve(values.transcript)) ? outDir : path.dirname(path.resolve(values.transcript)), values.transcript);
const transcript = values.transcript ? fs.createWriteStream(values.transcript, { flags: "wx" }) : null;
// 流式事件每次都带着整条消息，一轮能写出好几 GB；完整内容在 message_end 与工具事件里都有
const STREAM_EVENTS = new Set(["message_update", "provider_stream_event", "tool_execution_update"]);
const toolCounts = new Map<string, number>();
session.subscribe((event: { type: string; toolName?: string; args?: unknown; message?: { stopReason?: string; errorMessage?: string } }) => {
  if (!STREAM_EVENTS.has(event.type)) transcript?.write(`${JSON.stringify({ at: Date.now(), ...event })}\n`);
  if (event.type === "tool_execution_start" && event.toolName) {
    toolCounts.set(event.toolName, (toolCounts.get(event.toolName) ?? 0) + 1);
    console.error(`[tool] ${event.toolName} ${JSON.stringify(event.args).slice(0, 160)}`);
  }
  if (event.type === "message_end" && event.message?.stopReason === "error" && event.message.errorMessage) {
    console.error(`[error] ${event.message.errorMessage}`);
  }
});

// 开跑前就把 PR 描述放进提示词：中档模型常常不去读，声明台账也要从描述里取；judge 只看 bodyDigest 覆盖的提示词，不额外附全文
if (role === "verifier" && !/\n描述：\n\s*\S/.test(prompt) && values.pr && githubToken) {
  const pull = await fetchPull();
  prompt += `\n\nPR 的标签与描述原文（开跑前读好的，不用再调 pr_view）：\n标签：${JSON.stringify(pull.labels.map((label) => label.name))}\n描述：\n${pull.body ?? ""}`;
}

const started = Date.now();
let timedOut = false;
const bounded = async (text: string, ms: number) => {
  const timer = setTimeout(() => {
    timedOut = true;
    void session.abort();
  }, ms);
  try {
    await session.prompt(text);
  } finally {
    clearTimeout(timer);
  }
};
let error: unknown = null;
try {
  await bounded(prompt, timeoutMin * 60_000);
  if (!report && !timedOut)
    await bounded(
      role === "verifier"
        ? "你还没调用 submit_report。现在按 schema 调用它交结果，没跑成的检查如实写成 SKIPPED 或 notVerified。"
        : "你还没调用 submit_report。现在按 schema 调用它交结果。",
      FOLLOW_UP_MS,
    );
} catch (caught) {
  error = caught;
}
if (timedOut) console.error(`超过上限，已中止（submit_report ${report ? "已交" : "没交"}）`);
const stats = session.getSessionStats();
session.dispose();
// 末尾的 process.exit 不等写流落盘：不等 end 的回调，收尾那几条事件会丢
if (transcript) await new Promise<void>((resolve) => transcript.end(resolve));
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.rmSync(piStateDir, { recursive: true, force: true });

const usage = {
  model: `${provider}/${modelId}`,
  thinking: values.thinking,
  minutes: Math.round((Date.now() - started) / 600) / 100,
  toolCalls: stats.toolCalls,
  tools: Object.fromEntries(toolCounts),
  tokens: stats.tokens,
  costUsd: Math.round(stats.cost * 10_000) / 10_000,
  sandbox: bwrap ? "bwrap" : "none",
  submitted: report !== null,
  effortSent,
};
console.error(JSON.stringify(usage));
setOutput("usage", JSON.stringify(usage));
if (process.env.GITHUB_STEP_SUMMARY)
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### pi ${role}\n\n${usage.model}（thinking ${usage.thinking}）：${usage.minutes} 分钟，${usage.toolCalls} 次工具调用，$${usage.costUsd}\n`);
if (report) setOutput("structured_output", JSON.stringify(report));
if (error) console.error(error);
process.exit(report ? 0 : 1);

async function fetchPull() {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY ?? "LYJW131/lyjwpage"}/pulls/${values.pr}`, {
    headers: { authorization: `Bearer ${githubToken}`, accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return (await res.json()) as { title: string; body: string | null; labels: { name: string }[]; head: { sha: string }; base: { ref: string } };
}

function setOutput(name: string, value: string) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) {
    console.log(`${name}=${value}`);
    return;
  }
  const delimiter = `EOF_${randomBytes(12).toString("hex")}`;
  fs.appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

async function loadPi(dir: string | undefined) {
  const roots = [dir, process.env.PI_SDK_DIR && path.join(process.env.PI_SDK_DIR, "node_modules"), globalRoot()].filter((root): root is string => Boolean(root));
  for (const root of roots) {
    const dir = path.join(root, "@earendil-works/pi-coding-agent");
    const entry = path.join(dir, "dist/index.js");
    if (fs.existsSync(entry)) return { sdk: await import(pathToFileURL(entry).href), sdkDir: dir };
  }
  throw new Error(`在 ${roots.join("、")} 里找不到 @earendil-works/pi-coding-agent：npm install --prefix <目录> 后用 PI_SDK_DIR 指过去`);
}

function globalRoot() {
  try {
    return execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

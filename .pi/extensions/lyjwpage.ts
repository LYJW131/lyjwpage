import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { segments } from "../../scripts/guard-forbidden-commands.mjs";

const REPO = "lyjw131/lyjwpage";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FORBIDDEN_GUARD = "scripts/guard-forbidden-commands.mjs";
const MERGE_GUARD = "scripts/guard-merge-method.ts";
const RULES_DIR = ".claude/rules";
const FILE_TOOLS = new Set(["read", "edit", "write"]);

const PI_NOTES = [
  "pi 环境下的工具替换（覆盖 AGENTS.md 与 skill 里的对应写法）：",
  "- Cloudflare 的查询与调用（含 Workers Observability 排错）用本地 `cf` CLI，不用旧版 wrangler；这里没有 Cloudflare Code Mode MCP。`cf deploy` 仍是禁区。",
  "- GitHub 操作用 `gh`；这里没有 GitHub MCP，也没有云端注入令牌的代理，扩展把 `gh auth token` 设成 `GH_TOKEN`，仓库脚本不用加 `NODE_USE_ENV_PROXY=1`。",
  "- 合并 PR 只用 `lyjwpage_merge_pr` 工具，参数照 `pnpm merge-message` 的输出填（`merge_method`、`commit_title`、`commit_message`、`expectedHeadSha`）；bash 里的 `gh pr merge` 与 `gh api` 合并一律拦下。守卫有提醒时第一次调用只返回提醒、不合，处理完用同样的参数再调一次。",
  "- 禁区命令由 `.pi/extensions/lyjwpage.ts` 在 bash 调用前交给仓库的守卫脚本检查。",
  "- 项目 skill 经 `.agents/skills` 软链到 `.claude/skills`；`.claude/rules/` 与子目录 `AGENTS.md` 在读写匹配文件时附在该次工具结果后面。",
].join("\n");

type HookResult = { code: number; stdout: string; stderr: string };
type MergeRequest = { pr: number; method: "squash" | "merge"; subject: string; body: string; expectedHeadSha: string };
type Rule = { file: string; globs: string[] };

// 仓库不装 pi，类型检查拿不到 @earendil-works/pi-coding-agent 的 ExtensionAPI，这里只描述用到的那部分。
type ToolEvent = { toolName: string; toolCallId: string; input: Record<string, unknown> };
type PiEvents = {
  session_start: unknown;
  session_compact: unknown;
  before_agent_start: { systemPromptOptions: { sections: Record<string, string> } };
  tool_call: ToolEvent;
  tool_result: ToolEvent & { isError: boolean; content: unknown[] };
};
type ToolResult = { content: { type: "text"; text: string }[]; details: unknown };
type ExtensionAPI = {
  on<K extends keyof PiEvents>(name: K, handler: (event: PiEvents[K], ctx: { cwd: string }) => unknown): void;
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    parameters: object;
    execute(toolCallId: string, params: MergeRequest, signal: AbortSignal | undefined, onUpdate: unknown, ctx: { cwd: string }): Promise<ToolResult>;
  }): void;
};

function runHook(cwd: string, script: string, toolInput: unknown, timeout: number, env: Record<string, string> = {}): Promise<HookResult> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [script],
      { cwd, timeout, maxBuffer: 1 << 20, env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, ...env } },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : -1;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
    child.stdin?.end(JSON.stringify({ tool_input: toolInput }));
  });
}

const program = (token: string) => path.posix.basename(token);
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const WRAPPERS = new Set(["env", "sudo", "nohup", "time", "command", "exec", "nice", "timeout", "xargs"]);
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
const MAX_NESTING = 4;

function programIndex(tokens: string[]): number {
  let i = 0;
  while (i < tokens.length && (ASSIGNMENT.test(tokens[i]) || WRAPPERS.has(program(tokens[i])) || (i > 0 && (tokens[i].startsWith("-") || /^\d+[smhd]?$/.test(tokens[i]))))) i += 1;
  return i;
}

export function commandsOf(command: string, depth = 0): string[] {
  const found = [command];
  if (depth >= MAX_NESTING) return found;
  for (const tokens of segments(command) as string[][]) {
    const at = programIndex(tokens);
    const name = program(tokens[at] ?? "");
    if (name === "eval") found.push(...commandsOf(tokens.slice(at + 1).join(" "), depth + 1));
    if (!SHELLS.has(name)) continue;
    const flag = tokens.findIndex((arg, j) => j > at && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(arg));
    const inner = flag === -1 ? undefined : tokens[flag + 1];
    if (inner !== undefined) found.push(...commandsOf(inner, depth + 1));
  }
  return found;
}

const API_FIELD_OPTIONS = new Set(["-f", "--raw-field", "-F", "--field", "--input"]);
const MERGE_TEXT = /\bgh\s+pr\s+merge\b|["']pr["']\s*,\s*["']merge["']|pulls\/[^/\s]+\/merge\b|mergePullRequest|enablePullRequestAutoMerge/;
const INTERPRETERS = new Set(["node", "python", "python3", "ruby", "perl", "deno", "bun"]);
const INLINE_FLAGS = new Set(["-e", "-c", "-p", "--eval", "--print"]);
const REPO_OPTIONS = new Set(["-R", "--repo"]);
const HTTP_CLIENTS = new Set(["curl", "wget", "http", "https", "xh"]);
const isGh = (token: string) => program(token) === "gh" || token.includes("$");

function apiMergesPull(tokens: string[]): boolean {
  const gh = tokens.findIndex((token) => program(token) === "gh");
  if (gh === -1 || !tokens.slice(gh + 1).includes("api")) return false;
  const args = tokens.slice(gh + 1);
  if (args.some((token) => /mergePullRequest|enablePullRequestAutoMerge/.test(token))) return true;
  const explicit = args.flatMap((token, i) => {
    if (token === "-X" || token === "--method") return [args[i + 1] ?? ""];
    const attached = token.match(/^(?:-X|--method=)(.+)$/);
    return attached === null ? [] : [attached[1]];
  })[0];
  const method = (explicit ?? (args.some((token) => API_FIELD_OPTIONS.has(token)) ? "POST" : "GET")).toUpperCase();
  return method !== "GET" && args.some((token) => /pulls\/[^/\s]+\/merge\b/.test(token));
}

function httpMerge(tokens: string[]): boolean {
  if (!HTTP_CLIENTS.has(program(tokens[programIndex(tokens)] ?? ""))) return false;
  if (!tokens.some((token) => /api\.github\.com|\/api\/v3\//.test(token) && /pulls\/[^/\s]+\/merge\b/.test(token))) return false;
  return tokens.some((token, i) =>
    /^(-X|--request=|--method=)put$/i.test(token) || (/^put$/i.test(token) && /^(-X|--request|--method)$/.test(tokens[i - 1] ?? "")));
}

function prMerge(tokens: string[]): boolean {
  if (!tokens.some(isGh)) return false;
  for (let i = tokens.indexOf("pr"); i !== -1; i = tokens.indexOf("pr", i + 1)) {
    let j = i + 1;
    while (j < tokens.length && tokens[j].startsWith("-")) j += REPO_OPTIONS.has(tokens[j]) ? 2 : 1;
    if (tokens[j] === "merge") return true;
  }
  return false;
}

function inlineScriptMerges(tokens: string[]): boolean {
  if (!INTERPRETERS.has(program(tokens[programIndex(tokens)] ?? ""))) return false;
  return tokens.some((token, i) => INLINE_FLAGS.has(tokens[i - 1] ?? "") && MERGE_TEXT.test(token));
}

// 合并不在 bash 里解析：gh 的选项别名、先后与 shell 引号的组合拦不全，统一交给 lyjwpage_merge_pr 工具，它不经 shell 直接调 gh。
// 这里只防 agent 顺手写出的合并：命令文本里看得见的才拦，跑一个事先写好的脚本文件拦不到。
export function mergesViaShell(command: string): boolean {
  return commandsOf(command).flatMap((text) => segments(text) as string[][]).some((tokens) =>
    prMerge(tokens) || apiMergesPull(tokens) || httpMerge(tokens) || inlineScriptMerges(tokens));
}

export function mergeArgs(input: MergeRequest): string[] {
  return [
    "pr", "merge", String(input.pr), "--repo", REPO, `--${input.method}`,
    "--subject", input.subject, "--body", input.body, "--match-head-commit", input.expectedHeadSha,
  ];
}

function parseRule(file: string): Rule | null {
  const text = fs.readFileSync(file, "utf8");
  const front = text.match(/^---\n([\s\S]*?)\n---/)?.[1];
  if (front === undefined) return null;
  const globs = [...front.matchAll(/^\s+-\s+["']?([^"'\n]+?)["']?\s*$/gm)].map((match) => match[1]);
  return globs.length > 0 ? { file, globs } : null;
}

export function loadRules(cwd: string): Rule[] {
  const dir = path.join(cwd, RULES_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => parseRule(path.join(dir, name)))
    .filter((rule): rule is Rule => rule !== null);
}

function realpathOfNearest(target: string): string {
  let existing = target;
  while (!fs.existsSync(existing) && path.dirname(existing) !== existing) existing = path.dirname(existing);
  return path.join(fs.realpathSync(existing), path.relative(existing, target));
}

export function contextFor(cwd: string, filePath: string, rules: Rule[], loaded: Set<string>): string[] {
  const root = fs.realpathSync(cwd);
  const resolved = path.resolve(cwd, filePath);
  // skill 经 .agents/skills 软链读写时（含新建、目标还不存在），要按 .claude/skills 匹配 routines 规则。
  const absolute = realpathOfNearest(resolved);
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  if (relative === "" || relative.startsWith("..")) return [];
  const files: string[] = [];
  for (let dir = path.dirname(absolute); dir !== root && dir.startsWith(root + path.sep); dir = path.dirname(dir)) {
    const agents = path.join(dir, "AGENTS.md");
    if (fs.existsSync(agents)) files.unshift(agents);
  }
  for (const rule of rules) {
    if (rule.globs.some((glob) => path.matchesGlob(relative, glob))) files.push(rule.file);
  }
  return files.filter((file) => {
    if (loaded.has(file)) return false;
    loaded.add(file);
    return true;
  });
}

// 本地没有云端那层注入令牌的 GitHub 代理，仓库脚本匿名读 api.github.com 会撞按 IP 共享的匿名限额；借 gh 的登录令牌给 bash 与守卫脚本。
function adoptGhToken(): Promise<void> {
  if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) return Promise.resolve();
  return new Promise((resolve) => {
    execFile("gh", ["auth", "token"], { timeout: 5_000 }, (error, stdout) => {
      const token = String(stdout).trim();
      if (error === null && token !== "") process.env.GH_TOKEN = token;
      resolve();
    });
  });
}

const MERGE_PARAMETERS = {
  type: "object",
  properties: {
    pr: { type: "integer", minimum: 1, description: "lyjw131/lyjwpage 的 PR 号" },
    method: { type: "string", enum: ["squash", "merge"], description: "pnpm merge-message 输出的 merge_method" },
    subject: { type: "string", minLength: 1, description: "commit_title" },
    body: { type: "string", description: "commit_message" },
    expectedHeadSha: { type: "string", pattern: "^[0-9a-f]{40}$", description: "expectedHeadSha，完整 40 位" },
  },
  required: ["pr", "method", "subject", "body", "expectedHeadSha"],
  additionalProperties: false,
};

function runGh(cwd: string, args: string[], signal: AbortSignal | undefined): Promise<HookResult> {
  return new Promise((resolve) => {
    execFile("gh", args, { cwd, timeout: 120_000, maxBuffer: 1 << 20, signal }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : -1;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export default function lyjwpage(pi: ExtensionAPI) {
  let rules: Rule[] = [];
  const loaded = new Set<string>();
  const acknowledged = new Set<string>();

  // 压缩后先前附上的规则正文可能已被摘要掉，要允许重新附上。
  const reset = (cwd: string) => {
    rules = loadRules(cwd);
    loaded.clear();
    acknowledged.clear();
  };
  let tokenReady = adoptGhToken();
  pi.on("session_start", () => {
    tokenReady = adoptGhToken();
    reset(ROOT);
  });
  pi.on("session_compact", () => reset(ROOT));

  pi.on("before_agent_start", (event) => {
    event.systemPromptOptions.sections.lyjwpage_pi = PI_NOTES;
  });

  // lyjw 在输入框用 `!` 跑的命令走 user_bash，不经这里：禁区的手动部署例外靠的就是它。
  pi.on("tool_call", async (event) => {
    if (event.toolName !== "bash") return undefined;
    const command = event.input.command;
    if (typeof command !== "string") return undefined;
    await tokenReady;

    for (const text of commandsOf(command)) {
      const forbidden = await runHook(ROOT, FORBIDDEN_GUARD, { command: text }, 15_000);
      if (forbidden.code !== 0) {
        return { block: true, reason: forbidden.stderr.trim() || `守卫脚本 ${FORBIDDEN_GUARD} 没跑完（退出码 ${forbidden.code}），按拦下处理。` };
      }
    }

    if (mergesViaShell(command)) {
      return { block: true, reason: "已拦下：合并 PR 用 `lyjwpage_merge_pr` 工具（参数照 `pnpm merge-message` 的输出），bash 里的 `gh pr merge` 与 `gh api` 合并不放行。" };
    }
    return undefined;
  });

  pi.registerTool({
    name: "lyjwpage_merge_pr",
    label: "Merge lyjwpage PR",
    description: "合并 lyjw131/lyjwpage 的 PR：先交给 scripts/guard-merge-method.ts 检查合并方式、do-not-merge 标签、回执与注释提醒，再不经 shell 调 `gh pr merge --match-head-commit`。参数照 `pnpm merge-message <号> \"<标题>\"` 的输出填。守卫有提醒时第一次只返回提醒、不合，用同样的参数再调一次才合。",
    parameters: MERGE_PARAMETERS,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      await tokenReady;
      const guard = await runHook(ROOT, MERGE_GUARD, {
        owner: "lyjw131", repo: "lyjwpage", pullNumber: params.pr, merge_method: params.method, expectedHeadSha: params.expectedHeadSha,
      }, 60_000, { NODE_USE_ENV_PROXY: "1" });
      if (guard.code !== 0) throw new Error(guard.stderr.trim() || `守卫脚本 ${MERGE_GUARD} 没跑完（退出码 ${guard.code}），按拦下处理。`);
      let notice: unknown;
      try {
        notice = JSON.parse(guard.stdout)?.hookSpecificOutput?.additionalContext;
      } catch {
        // 守卫没有提醒时 stdout 为空。
      }
      const key = JSON.stringify(params);
      if (typeof notice === "string" && !acknowledged.has(key)) {
        acknowledged.add(key);
        return { content: [{ type: "text", text: `还没合：合并守卫的提醒（不是拒绝）\n${notice}\n处理完（该删的注释删掉推送后 sha 会变，重跑 pnpm merge-message），或确认照合，就用同样的参数再调一次。` }], details: undefined };
      }
      const merged = await runGh(ctx.cwd, mergeArgs(params), signal);
      if (merged.code !== 0) throw new Error(`gh pr merge 失败（退出码 ${merged.code}）：${merged.stderr.trim()}`);
      return { content: [{ type: "text", text: `已合并 #${params.pr}。\n${merged.stdout}${merged.stderr}`.trim() }], details: undefined };
    },
  });

  pi.on("tool_result", (event, ctx) => {
    const extra: string[] = [];
    const filePath = event.input.path;
    if (FILE_TOOLS.has(event.toolName) && !event.isError && typeof filePath === "string") {
      for (const file of contextFor(ROOT, path.resolve(ctx.cwd, filePath), rules, loaded)) {
        const name = path.relative(ROOT, file);
        extra.push(`<project-rule path="${name}">\n${fs.readFileSync(file, "utf8").trim()}\n</project-rule>`);
      }
    }
    if (extra.length === 0) return undefined;
    return { content: [...event.content, { type: "text", text: `\n\n${extra.join("\n\n")}` }] };
  });
}

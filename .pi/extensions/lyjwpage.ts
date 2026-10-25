import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { segments } from "../../scripts/guard-forbidden-commands.mjs";

const REPO = "lyjw131/lyjwpage";
const FORBIDDEN_GUARD = "scripts/guard-forbidden-commands.mjs";
const MERGE_GUARD = "scripts/guard-merge-method.ts";
const RULES_DIR = ".claude/rules";
const FILE_TOOLS = new Set(["read", "edit", "write"]);

const PI_NOTES = [
  "pi 环境下的工具替换（覆盖 AGENTS.md 与 skill 里的对应写法）：",
  "- Cloudflare 的查询与调用（含 Workers Observability 排错）用本地 `cf` CLI，不用旧版 wrangler；这里没有 Cloudflare Code Mode MCP。`cf deploy` 仍是禁区。",
  "- GitHub 操作用 `gh`；这里没有 GitHub MCP。合并照 `pnpm merge-message` 的输出跑 `gh pr merge <号> --squash|--merge --subject <commit_title> --body <commit_message> --match-head-commit <expectedHeadSha>`，参数都写字面值。守卫有提醒时第一次会拦下并附上提醒，处理完原样再跑一次即放行。",
  "- 禁区命令与合并方式由 `.pi/extensions/lyjwpage.ts` 在 bash 调用前交给仓库的守卫脚本检查。",
  "- 项目 skill 经 `.agents/skills` 软链到 `.claude/skills`；`.claude/rules/` 与子目录 `AGENTS.md` 在读写匹配文件时附在该次工具结果后面。",
].join("\n");

type HookResult = { code: number; stdout: string; stderr: string };
type MergeInput = { owner: string; repo: string; pullNumber?: number; merge_method?: string; expectedHeadSha?: string };
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
type ExtensionAPI = { on<K extends keyof PiEvents>(name: K, handler: (event: PiEvents[K], ctx: { cwd: string }) => unknown): void };

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
const MAX_NESTING = 4;

export function commandsOf(command: string, depth = 0): string[] {
  const found = [command];
  if (depth >= MAX_NESTING) return found;
  for (const tokens of segments(command) as string[][]) {
    tokens.forEach((token, i) => {
      const name = program(token);
      if (name === "eval") found.push(...commandsOf(tokens.slice(i + 1).join(" "), depth + 1));
      if (!SHELLS.has(name)) return;
      const flag = tokens.findIndex((arg, j) => j > i && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(arg));
      const inner = flag === -1 ? undefined : tokens[flag + 1];
      if (inner !== undefined) found.push(...commandsOf(inner, depth + 1));
    });
  }
  return found;
}

function ghArgs(tokens: string[]): string[] | null {
  const at = tokens.findIndex((token) => program(token) === "gh");
  return at === -1 ? null : tokens.slice(at + 1);
}

function optionValue(args: string[], names: string[]): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    for (const name of names) {
      if (args[i] === name) return args[i + 1];
      if (args[i].startsWith(`${name}=`)) return args[i].slice(name.length + 1);
      if (/^-[a-zA-Z]$/.test(name) && args[i].startsWith(name) && args[i].length > 2) return args[i].slice(2);
    }
  }
  return undefined;
}

const VALUE_OPTIONS = new Set(["-R", "--repo", "--match-head-commit", "-t", "--subject", "-b", "--body", "-F", "--body-file", "-A", "--author-email"]);

function repoOf(spec: string): { host: string; owner: string; repo: string } {
  const parts = spec.replace(/^[a-z]+:\/\//i, "").replace(/\.git$/, "").split("/").filter(Boolean);
  const [owner = "", repo = ""] = parts.slice(-2);
  return { host: parts.length > 2 ? parts[0].toLowerCase() : "github.com", owner, repo };
}

export function ghMergeInputs(command: string): MergeInput[] {
  const merges: MergeInput[] = [];
  for (const tokens of commandsOf(command).flatMap((text) => segments(text) as string[][])) {
    const args = ghArgs(tokens);
    if (args === null || args[0] !== "pr" || args[1] !== "merge") continue;
    const rest = args.slice(2);
    const target = rest.find((token, i) => !token.startsWith("-") && !VALUE_OPTIONS.has(rest[i - 1] ?? ""));
    const url = target?.match(/^(?:https?:\/\/)?([^/]+\/[^/]+\/[^/]+)\/pull\/(\d+)/);
    const { host, owner, repo } = repoOf(url?.[1] ?? optionValue(rest, ["-R", "--repo"]) ?? REPO);
    const pr = url?.[2] ?? target?.match(/^\d+$/)?.[0];
    const method = rest.some((t) => t === "--squash" || t === "-s") ? "squash"
      : rest.some((t) => t === "--merge" || t === "-m") ? "merge"
      : rest.some((t) => t === "--rebase" || t === "-r") ? "rebase"
      : undefined;
    merges.push({
      owner: host === "github.com" ? owner : `${host}/${owner}`,
      repo,
      pullNumber: pr === undefined ? undefined : Number(pr),
      merge_method: method,
      expectedHeadSha: optionValue(rest, ["--match-head-commit"]),
    });
  }
  return merges;
}

export function apiMergesPull(command: string): boolean {
  return commandsOf(command).flatMap((text) => segments(text) as string[][]).some((tokens) => {
    const args = ghArgs(tokens);
    if (args === null || args[0] !== "api") return false;
    if (args.some((token) => /mergePullRequest|enablePullRequestAutoMerge/.test(token))) return true;
    const method = optionValue(args, ["-X", "--method"])?.toUpperCase();
    return method === "PUT" && args.some((token) => /pulls\/\d+\/merge\b/.test(token));
  });
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

export default function lyjwpage(pi: ExtensionAPI) {
  let rules: Rule[] = [];
  const loaded = new Set<string>();
  const acknowledged = new Set<string>();

  // 压缩后先前附上的规则正文可能已被摘要掉，要允许重新附上。
  const reset = (cwd: string) => {
    rules = loadRules(cwd);
    loaded.clear();
  };
  pi.on("session_start", (_event, ctx) => reset(ctx.cwd));
  pi.on("session_compact", (_event, ctx) => reset(ctx.cwd));

  pi.on("before_agent_start", (event) => {
    event.systemPromptOptions.sections.lyjwpage_pi = PI_NOTES;
  });

  // lyjw 在输入框用 `!` 跑的命令走 user_bash，不经这里：禁区的手动部署例外靠的就是它。
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return undefined;
    const command = event.input.command;
    if (typeof command !== "string") return undefined;

    for (const text of commandsOf(command)) {
      const forbidden = await runHook(ctx.cwd, FORBIDDEN_GUARD, { command: text }, 15_000);
      if (forbidden.code !== 0) {
        return { block: true, reason: forbidden.stderr.trim() || `守卫脚本 ${FORBIDDEN_GUARD} 没跑完（退出码 ${forbidden.code}），按拦下处理。` };
      }
    }

    if (apiMergesPull(command)) {
      return { block: true, reason: "已拦下：合并 PR 用 `gh pr merge`，它才经过合并方式守卫。" };
    }

    const merges = ghMergeInputs(command);
    if (merges.length === 0) return undefined;
    // 守卫按字面参数认 PR；变量与命令替换要到执行时才展开，认不出真正合的是哪个 PR。
    if (/[$`]/.test(command)) {
      return { block: true, reason: "已拦下：`gh pr merge` 所在命令里不要用变量或命令替换，仓库、PR 号、标题、正文与 sha 都写成字面值。" };
    }
    const notices: string[] = [];
    for (const merge of merges) {
      const isLyjwpage = merge.owner.toLowerCase() === "lyjw131" && merge.repo.toLowerCase() === "lyjwpage";
      if (isLyjwpage && merge.pullNumber === undefined) {
        return { block: true, reason: "已拦下：`gh pr merge` 要写明 PR 号，合并守卫按号查标签与回执。" };
      }
      const result = await runHook(ctx.cwd, MERGE_GUARD, merge, 60_000, { NODE_USE_ENV_PROXY: "1" });
      if (result.code !== 0) {
        return { block: true, reason: result.stderr.trim() || `守卫脚本 ${MERGE_GUARD} 没跑完（退出码 ${result.code}），按拦下处理。` };
      }
      try {
        const notice = JSON.parse(result.stdout)?.hookSpecificOutput?.additionalContext;
        if (typeof notice === "string") notices.push(notice);
      } catch {
        // 守卫没有提醒时 stdout 为空。
      }
    }
    // 提醒要在合并前看到：第一次拦下并带上提醒，看过后原样再跑同一条命令就放行。
    if (notices.length === 0 || acknowledged.has(command)) return undefined;
    acknowledged.add(command);
    return { block: true, reason: `合并守卫的提醒（不是拒绝）：\n${notices.join("\n")}\n处理完（该删的注释删掉推送后，sha 会变），或确认照合，就原样再跑一次同一条命令。` };
  });

  pi.on("tool_result", (event, ctx) => {
    const extra: string[] = [];
    const filePath = event.input.path;
    if (FILE_TOOLS.has(event.toolName) && !event.isError && typeof filePath === "string") {
      for (const file of contextFor(ctx.cwd, filePath, rules, loaded)) {
        const name = path.relative(ctx.cwd, file);
        extra.push(`<project-rule path="${name}">\n${fs.readFileSync(file, "utf8").trim()}\n</project-rule>`);
      }
    }
    if (extra.length === 0) return undefined;
    return { content: [...event.content, { type: "text", text: `\n\n${extra.join("\n\n")}` }] };
  });
}

import { spawn } from "node:child_process";

export const MODEL = "swe-2-max";

// 交给 `devin --config` 的整份用户配置：只留读文件、grep、按名找文件三个工具，不导入任何别家的规则、skill 与 MCP，不开子代理。
// 被拒的工具调用会让 `-p` 整轮结束，所以不靠 deny 拦工具，而是用 disabled_tools 摘掉。
// 不能写 tool 级的 allow（如 "read"）：它会压过下面的 Read(...) deny。
// denyRead 是工作区以外不许读的路径（评测时含其他用例的快照，免得读到后来的修复）。
const DISABLED_TOOLS = [
  "ask_user_question",
  "browser_preview",
  "close_browser_preview",
  "edit",
  "write",
  "exec",
  "get_output",
  "kill_shell",
  "write_to_process",
  "notebook_edit",
  "notebook_read",
  "web_search",
  "webfetch",
  "mcp_call_tool",
  "mcp_list_servers",
  "mcp_list_tools",
  "mcp_read_resource",
  "request_scope",
  "skill",
  "todo_write",
];

export function reviewerConfig(denyRead: string[], extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    agent: { model: MODEL },
    subagents_enabled: false,
    attribution: false,
    auto_update: false,
    disabled_tools: DISABLED_TOOLS,
    permissions: { deny: denyRead.map((path) => `Read(${path})`) },
    read_config_from: {
      agents_standard: false,
      cursor: false,
      windsurf: false,
      claude: false,
      copilot: false,
      opencode: false,
      zed: false,
      cloud: false,
    },
    ...extra,
  };
}

// 工作区外一律不许读：/proc 下能读到父进程的环境变量（含 GITHUB_TOKEN），家目录里有 Devin 凭据。
export const SYSTEM_DENY_READ = [
  "/proc/**",
  "/sys/**",
  "/dev/**",
  "/etc/**",
  "/home/**",
  "/root/**",
  "/mnt/**",
  "/opt/**",
  "/srv/**",
  "/usr/**",
  "/var/lib/**",
  "/var/run/**",
  "/run/**",
];

// 子进程只拿到跑 CLI 要的环境变量，令牌一类不传下去。
const ENV_KEEP = /^(PATH|HOME|USER|LANG|LC_\w+|TERM|TMPDIR|XDG_\w+|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|REQUESTS_CA_BUNDLE|OTEL_\w+|https?_proxy|HTTPS?_PROXY|no_proxy|NO_PROXY|ALL_PROXY|all_proxy)$/;

function childEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => ENV_KEEP.test(key)));
}

export type DevinRun = { code: number | null; stdout: string; stderr: string; ms: number };

export function runDevin(opts: {
  cwd: string;
  promptFile: string;
  configPath: string;
  exportPath: string;
  model?: string;
  timeoutMs: number;
  bin?: string;
}): Promise<DevinRun> {
  const args = [
    "--config",
    opts.configPath,
    "--model",
    opts.model ?? MODEL,
    "--respect-workspace-trust",
    "false",
    "--export",
    opts.exportPath,
    "--prompt-file",
    opts.promptFile,
    "-p",
  ];
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(opts.bin ?? "devin", args, { cwd: opts.cwd, env: childEnv(), timeout: opts.timeoutMs, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr, ms: Date.now() - started }));
  });
}

// 免费档限流时 CLI 报出重置时刻（「at 06:01 UTC」）；读不出返回 null。
export function rateLimitReset(text: string, now = new Date()): Date | null {
  if (!/rate limit/i.test(text)) return null;
  const m = /at (\d{1,2}):(\d{2}) UTC/.exec(text);
  if (!m) return null;
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Number(m[1]), Number(m[2])));
  if (reset.getTime() < now.getTime()) reset.setUTCDate(reset.getUTCDate() + 1);
  return reset;
}

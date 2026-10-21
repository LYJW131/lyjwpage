import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RUNNERS = new Set(["pnpm", "npm", "yarn", "bun"]);
const LOCAL_CREDENTIAL = /(^|\/)(\.dev\.vars|\.env)([.-][^/]*)?$/;
const EXAMPLE = /\.example$/;

// 只剥掉 heredoc 正文：提交信息里写「不手跑 wrangler deploy」不该被拦。
function stripHeredocs(command) {
  const lines = command.split("\n");
  const kept = [];
  let delimiter = null;
  for (const line of lines) {
    if (delimiter !== null) {
      if (line.trim() === delimiter) delimiter = null;
      continue;
    }
    kept.push(line);
    const match = line.match(/<<-?\s*(['"]?)([\w.-]+)\1/);
    if (match) delimiter = match[2];
  }
  return kept.join("\n");
}

export function segments(command) {
  const text = stripHeredocs(command);
  const result = [];
  let tokens = [];
  let token = "";
  let quoted = false;
  const endToken = () => {
    if (token !== "" || quoted) tokens.push(token);
    token = "";
    quoted = false;
  };
  const endSegment = () => {
    endToken();
    if (tokens.length > 0) result.push(tokens);
    tokens = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "'") {
      const end = text.indexOf("'", i + 1);
      token += text.slice(i + 1, end === -1 ? text.length : end);
      quoted = true;
      i = end === -1 ? text.length : end;
    } else if (char === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\" && j + 1 < text.length) j += 1;
        token += text[j];
        j += 1;
      }
      quoted = true;
      i = j;
    } else if (char === "\\" && i + 1 < text.length) {
      token += text[i + 1];
      i += 1;
    } else if (char === "$" && text[i + 1] === "(") {
      endSegment();
      i += 1;
    } else if (";&|\n()`".includes(char)) {
      endSegment();
    } else if (/\s/.test(char)) {
      endToken();
    } else {
      token += char;
    }
  }
  endSegment();
  return result;
}

const program = (token) => path.posix.basename(token).replace(/@.*$/, "");

function wranglerDeploy(tokens) {
  const at = tokens.findIndex((token) => program(token) === "wrangler");
  if (at === -1) return false;
  const rest = tokens.slice(at + 1);
  return rest.includes("deploy") && !rest.includes("--dry-run");
}

const CF_PROGRAMS = new Set(["cf", "cloudflare"]);

// cf 的 previews deploy 等同 wrangler preview，只发分支 Preview，不拦。
function cfDeploy(tokens) {
  const at = tokens.findIndex((token) => CF_PROGRAMS.has(program(token)));
  if (at === -1) return false;
  const rest = tokens.slice(at + 1);
  if (rest.includes("--dry-run") || rest.includes("previews")) return false;
  return rest.includes("deploy") || (rest.includes("deployments") && rest.includes("create"));
}

function deployScript(tokens) {
  if (!tokens.some((token) => RUNNERS.has(program(token)))) return false;
  const args = tokens.filter((token) => !token.startsWith("-"));
  return args.some((token, i) => {
    if (token !== "deploy") return false;
    const before = args[i - 1];
    return before === "run" || before === "run-script" || program(before ?? "") === "yarn";
  });
}

function forceAddsLocalCredential(tokens) {
  const git = tokens.findIndex((token) => program(token) === "git");
  if (git === -1) return false;
  const rest = tokens.slice(git + 1);
  if (!rest.includes("add")) return false;
  const force = rest.some((token) => token === "--force" || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(token));
  return force && rest.some((token) => LOCAL_CREDENTIAL.test(token) && !EXAMPLE.test(token));
}

const IDENTITY_ENV = /^GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL)=/;
const IDENTITY_KEYS = new Set(["user.name", "user.email", "user.signingkey", "commit.gpgsign", "gpg.format", "gpg.ssh.program"]);
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
const ENV_SETTERS = new Set(["export", "env", "declare", "typeset"]);

function overridesCommitIdentity(tokens) {
  const lead = tokens.findIndex((token) => !ASSIGNMENT.test(token));
  const assignments = lead === -1 ? tokens : tokens.slice(0, lead);
  if (assignments.some((token) => IDENTITY_ENV.test(token))) return true;
  if (lead !== -1 && ENV_SETTERS.has(program(tokens[lead])) && tokens.slice(lead + 1).some((token) => IDENTITY_ENV.test(token))) return true;
  const git = tokens.findIndex((token) => program(token) === "git");
  if (git === -1) return false;
  const rest = tokens.slice(git + 1);
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    const value =
      token === "-c" || token === "--config-env" ? rest[i + 1]
      : token.startsWith("--config-env=") ? token.slice("--config-env=".length)
      : token.startsWith("-c") ? token.slice(2)
      : null;
    if (value && IDENTITY_KEYS.has(value.split("=")[0].toLowerCase()) && value.includes("=")) return true;
  }
  if (rest.includes("--no-gpg-sign")) return true;
  const sub = subcommand(rest);
  if (sub === -1) return false;
  const args = rest.slice(sub + 1);
  if (rest[sub] === "commit") return args.some((token) => token === "--author" || token.startsWith("--author="));
  if (rest[sub] !== "config") return false;
  if (args.some((token) => CONFIG_READS.has(token) || token.startsWith("--get"))) return false;
  let operands = args.filter((token, i) => !token.startsWith("-") && !CONFIG_OPTIONS_WITH_VALUE.has(args[i - 1]));
  if (operands[0] === "get" || operands[0] === "list") return false;
  const verb = operands[0] === "set" || operands[0] === "unset";
  if (verb) operands = operands.slice(1);
  const unset = verb || args.some((token) => token.startsWith("--unset") || token === "--replace-all");
  return IDENTITY_KEYS.has((operands[0] ?? "").toLowerCase()) && (operands.length >= 2 || unset);
}

const CONFIG_READS = new Set(["--list", "-l"]);
const CONFIG_OPTIONS_WITH_VALUE = new Set(["--file", "-f", "--blob", "--type", "--default", "--comment", "--value"]);
const GIT_OPTIONS_WITH_VALUE = new Set(["-c", "-C", "--config-env", "--git-dir", "--work-tree", "--namespace"]);

function subcommand(rest) {
  for (let i = 0; i < rest.length; i += 1) {
    if (GIT_OPTIONS_WITH_VALUE.has(rest[i])) i += 1;
    else if (!rest[i].startsWith("-")) return i;
  }
  return -1;
}

const DEPLOY_REASON =
  "手动部署 Worker 是 AGENTS.md「禁区」：Worker 只经 Workers Builds 部署。跨 Worker 契约切换那唯一的例外由 lyjw 在自己的 shell 里跑（Mac 会话输入框用 `!` 前缀），见 .claude/skills/lyjwpage-mac-session/SKILL.md「自动模式拦了」。`wrangler deploy --dry-run`、`cf deploy --dry-run` 不受限。";
const IDENTITY_REASON =
  "改提交身份或关掉签名是 AGENTS.md「禁区」：环境已把 author / committer 设成 lyjw 的 noreply 邮箱并用 lyjw 的 SSH 钥签名，GitHub 按 committer 邮箱找签名钥，换成别的身份就显示 Unverified。agent 署名只写进提交信息末尾的 Co-Authored-By。云端 Stop 钩子（~/.claude/stop-hook-git-check.sh）报「Unverified」并让改成 noreply@anthropic.com 时不照做，直接 push 即可。";
const CREDENTIAL_REASON = "强制提交 .dev.vars / .env* 这类本地凭据文件是 AGENTS.md「禁区」；示例文件（*.example）照常提交。";

export function forbiddenReason(command) {
  for (const tokens of segments(command)) {
    if (wranglerDeploy(tokens) || cfDeploy(tokens) || deployScript(tokens)) return DEPLOY_REASON;
    if (forceAddsLocalCredential(tokens)) return CREDENTIAL_REASON;
    if (overridesCommitIdentity(tokens)) return IDENTITY_REASON;
  }
  return null;
}

function main() {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return;
  }
  const command = input?.tool_input?.command;
  if (typeof command !== "string") return;
  const reason = forbiddenReason(command);
  if (reason === null) return;
  process.stderr.write(`已拦下：${reason}\n`);
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();

import fs from "node:fs";
import path from "node:path";
import { quote } from "./guard.ts";

type Run = (command: string, timeoutMs: number, dir?: string) => Promise<{ code: string | number; output: string }>;
export type Claim = { id: string; claim: string; check: string };
// git 也要经沙箱跑：bash 能写 .git/config，diff.external、textconv、hooks 这类配置会让 git 替它执行命令
export type Git = (args: string[], dir?: string) => string;
export type ToolContext = { cwd: string; base: string; tmpDir: string; run: Run; git: Git; workLog: (name: string, text: string) => string | null };

const text = (body: string) => ({ content: [{ type: "text" as const, text: body }], details: undefined });
const tail = (body: string, lines: number) => body.split("\n").slice(-lines).join("\n");

// AGENTS.md「文档与注释」点名的同步范围：改了符号、常量、规则，这些地方的旧说法要同一提交改掉
const DOC_SCOPES = [":(glob)**/*.md", ":(glob)**/README*", "public/llms.txt", ":(glob).claude/**"];
const IDENTIFIER = /\b[A-Z][A-Z0-9_]{3,}\b|\b[a-z]+(?:[A-Z][a-z0-9]+)+\b|\b[\w.-]+\.(?:ts|mts|mjs|yml|yaml|json)\b/g;

export function removedIdentifiers(patch: string): string[] {
  const removed = new Set<string>();
  const added = new Set<string>();
  for (const line of patch.split("\n")) {
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    const target = line.startsWith("-") ? removed : line.startsWith("+") ? added : null;
    for (const word of target ? (line.slice(1).match(IDENTIFIER) ?? []) : []) target!.add(word);
  }
  return [...removed].filter((word) => !added.has(word)).slice(0, 20);
}

let logSeq = 0;

export function prDiffTool(ctx: ToolContext) {
  return {
    name: "pr_diff",
    label: "PR diff",
    description: `这次改动：git diff ${ctx.base}...HEAD。stat=true 只给每个文件的增删行数；paths 限定文件。超过 60KB 截断，全文写进产物目录 work/。`,
    parameters: { type: "object", properties: { stat: { type: "boolean" }, paths: { type: "array", items: { type: "string" } } } },
    execute: async (_id: string, params: { stat?: boolean; paths?: string[] }) => {
      const out = ctx.git(["diff", ...(params.stat ? ["--stat=200"] : []), `${ctx.base}...HEAD`, ...(params.paths?.length ? ["--", ...params.paths] : [])]);
      if (out.length <= 60_000) return text(out || "（没有差异）");
      const file = ctx.workLog(`diff-${++logSeq}.patch`, out);
      return text(`${out.slice(0, 60_000)}\n…（截断，全文 ${file ?? "未保存"}）`);
    },
  };
}

export function runTestsTool(ctx: ToolContext) {
  return {
    name: "run_tests",
    label: "Run tests",
    description:
      "在仓库根用 node --test --experimental-strip-types --import ./src/lib/testing/register-alias.mjs 跑给定的测试文件（路径相对仓库根，workers/*/ 下的也从根跑）。返回退出码、tests/pass/fail 计数与失败段落；完整输出写进产物目录 work/。",
    parameters: {
      type: "object",
      required: ["files"],
      properties: { files: { type: "array", minItems: 1, items: { type: "string" } }, name: { type: "string", description: "日志文件名前缀" } },
    },
    execute: async (_id: string, params: { files: string[]; name?: string }) => {
      const started = Date.now();
      const { code, output } = await ctx.run(`node --test --test-reporter=tap --experimental-strip-types --import ./src/lib/testing/register-alias.mjs ${params.files.map(quote).join(" ")}`, 10 * 60_000);
      const file = ctx.workLog(`${(params.name ?? "tests").replace(/[^\w.-]/g, "_")}-${++logSeq}.log`, output);
      const counts = output.match(/^# (tests|pass|fail|cancelled|skipped) \d+$/gm)?.join(", ") ?? "没读到计数";
      const failures = output.match(/^not ok .*$[\s\S]*?(?=^(?:ok|not ok) |\n# tests)/gm)?.join("\n").slice(0, 6000) ?? "";
      return text(`退出码 ${code}，${Math.round((Date.now() - started) / 1000)} 秒；${counts}${file ? `；日志 ${file}` : ""}\n${failures || tail(output, 15)}`);
    },
  };
}

export function docsSyncTool(ctx: ToolContext) {
  return {
    name: "docs_sync",
    label: "Docs sync",
    description:
      "查改动涉及的说法在文档里有没有跟着改：在仓库的 *.md、README、public/llms.txt、.claude/（含 memory、skills、rules）里按关键词逐个搜，标出命中文件这次有没有改。keywords 填改名前的旧名、删掉或改了的常量、环境变量、工作流与文件名、规则用词、PR 标题里的名词；默认还会自动加上 diff 里删掉、又没在新代码里出现的标识符。",
    parameters: {
      type: "object",
      properties: { keywords: { type: "array", items: { type: "string" } }, auto: { type: "boolean", description: "自动加入 diff 里删掉的标识符，默认 true" } },
    },
    execute: async (_id: string, params: { keywords?: string[]; auto?: boolean }) => {
      const changed = new Set(ctx.git(["diff", "--name-only", `${ctx.base}...HEAD`]).split("\n").filter(Boolean));
      const auto = params.auto === false ? [] : removedIdentifiers(ctx.git(["diff", "-U0", `${ctx.base}...HEAD`]));
      const keywords = [...new Set([...(params.keywords ?? []), ...auto].map((word) => word.trim()).filter((word) => word.length >= 3))].slice(0, 40);
      if (!keywords.length) return text("没有可搜的关键词：给 keywords。");
      const lines: string[] = [];
      for (const keyword of keywords) {
        // 搜 HEAD 的树、不搜工作区：verify-agent action 已把工作区的 .claude/ 换成默认分支的版本
        let out: string;
        try {
          out = ctx.git(["grep", "-n", "-I", "-F", "--no-color", "-e", keyword, "HEAD", "--", ...DOC_SCOPES]);
        } catch (caught) {
          // git grep 没命中退出 1；别的退出码是搜索本身没跑成，不能写成 0 处
          if ((caught as { status?: number }).status === 1) out = "";
          else {
            lines.push(`「${keyword}」：搜索失败，没查到（${String((caught as Error).message).split("\n")[0].slice(0, 160)}），写进 notVerified`);
            continue;
          }
        }
        const hits = out
          .split("\n")
          .filter(Boolean)
          .map((hit) => hit.replace(/^HEAD:/, ""));
        if (!hits.length) {
          lines.push(`「${keyword}」：文档里 0 处`);
          continue;
        }
        const byFile = new Map<string, string[]>();
        for (const hit of hits) {
          const file = hit.slice(0, hit.indexOf(":"));
          byFile.set(file, [...(byFile.get(file) ?? []), hit.slice(file.length + 1).slice(0, 160)]);
        }
        lines.push(`「${keyword}」：${hits.length} 处`);
        for (const [file, rows] of [...byFile].slice(0, 8)) lines.push(`  ${file}${changed.has(file) ? "（这次改了）" : "（这次没改）"}：${rows.slice(0, 2).join(" ｜ ")}`);
      }
      const body = `${auto.length ? `自动加入的关键词：${auto.join("、")}\n` : ""}${lines.join("\n")}`;
      const file = ctx.workLog(`docs-sync-${Date.now()}.txt`, body);
      return text(`${body.slice(0, 12_000)}${body.length > 12_000 ? `\n…（截断，全文 ${file}）` : ""}\n\n标着「这次没改」又仍写着旧说法的，要判断是不是该同步却漏了。`);
    },
  };
}

export function compareBaseTool(ctx: ToolContext) {
  const baseDir = path.join(ctx.tmpDir, "base");
  const ensureBase = () => {
    if (fs.existsSync(baseDir)) return;
    const sha = ctx.git(["rev-parse", ctx.base]).trim();
    ctx.git(["clone", "-q", "--shared", "--no-checkout", ctx.cwd, baseDir]);
    ctx.git(["-C", baseDir, "checkout", "-q", "--detach", sha]);
    for (const top of [".", "workers", "reporters", "packages"]) {
      const dirs = top === "." ? ["."] : fs.existsSync(path.join(ctx.cwd, top)) ? fs.readdirSync(path.join(ctx.cwd, top)).map((name) => path.join(top, name)) : [];
      for (const dir of dirs) {
        const modules = path.join(ctx.cwd, dir, "node_modules");
        const target = path.join(baseDir, dir, "node_modules");
        if (fs.existsSync(modules) && fs.existsSync(path.join(baseDir, dir)) && !fs.existsSync(target)) fs.symlinkSync(modules, target);
      }
    }
  };
  return {
    name: "compare_base",
    label: "Compare with base",
    description: `在 HEAD 与目标分支（${ctx.base}）的检出上各跑一次同一条命令，并排给出两边的退出码与输出，用来做改动前后的差分对照：写一个探针脚本（放在 $TMPDIR，用绝对路径调用；import 仓库模块用相对仓库根的路径，两边都能解析），喂 PR 声称的那类输入，看行为差在哪、声明成不成立。目标分支的检出在 $TMPDIR/base，依赖与 HEAD 共用。`,
    parameters: {
      type: "object",
      required: ["command"],
      properties: { command: { type: "string", description: "在仓库根执行的 shell 命令" }, timeoutSec: { type: "number", description: "每边上限，默认 300" } },
    },
    execute: async (_id: string, params: { command: string; timeoutSec?: number }) => {
      ensureBase();
      const ms = Math.min(Math.max(params.timeoutSec ?? 300, 10), 900) * 1000;
      const [head, base] = await Promise.all([ctx.run(params.command, ms), ctx.run(params.command, ms, baseDir)]);
      const name = `compare-${Date.now()}`;
      const headFile = ctx.workLog(`${name}-head.log`, head.output);
      const baseFile = ctx.workLog(`${name}-base.log`, base.output);
      const same = head.output === base.output && head.code === base.code;
      return text(
        `${same ? "两边退出码与输出完全相同。" : "两边不同。"}\n== HEAD 退出码 ${head.code}${headFile ? `（全文 ${headFile}）` : ""}\n${tail(head.output, 60)}\n== ${ctx.base} 退出码 ${base.code}${baseFile ? `（全文 ${baseFile}）` : ""}\n${tail(base.output, 60)}`,
      );
    },
  };
}

export function claimsTool(ledger: Map<string, Claim>) {
  return {
    name: "claims",
    label: "Claims ledger",
    description:
      "声明台账：把 PR 标题、描述、验证清单、改动里新写的注释与文档所声称的行为逐条登记下来，每条写 id、原话（或贴近原话的一句）和打算用哪一行检查（check 填结果里的行 id，如 V1、X2）。量词（只、全部、每个、最高、不再、任何）与边界要单列。可多次调用，同 id 覆盖。交结果时每条声明都要有它指向的那一行。",
    parameters: {
      type: "object",
      required: ["claims"],
      properties: {
        claims: {
          type: "array",
          minItems: 1,
          items: { type: "object", required: ["id", "claim", "check"], properties: { id: { type: "string" }, claim: { type: "string" }, check: { type: "string" } } },
        },
      },
    },
    execute: async (_id: string, params: { claims: Claim[] }) => {
      for (const claim of params.claims) ledger.set(claim.id, claim);
      return text(`台账现有 ${ledger.size} 条：\n${[...ledger.values()].map((claim) => `- ${claim.id} → ${claim.check}：${claim.claim}`).join("\n")}`);
    },
  };
}

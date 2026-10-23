import type { ChecklistItem } from "./body.ts";

type Common = { pr: number; title: string; head: string; base: string; files: string[] };

const fileList = (files: string[]) => files.map((file) => `- ${file}`).join("\n");

export function verifierPrompt({
  pr,
  title,
  head,
  base,
  files,
  tier,
  need,
  preview,
  checklist,
  outDir,
}: Common & { tier: string; need: string; preview: string | null; checklist: ChecklistItem[]; outDir: string }) {
  const ui = tier.includes("ui");
  const site = preview
    ? `站点分支预览：${preview}（已部署到 head，或 head 之后只多了不碰站点的提交）。界面检查在它上面做。`
    : ui
      ? "站点分支预览没就绪。界面检查改在本地起：`pnpm dev`（连生产 Worker，地址 http://localhost:3211），后台起、跑完关掉。"
      : "这次不碰站点界面，不用开浏览器，除非清单点名要。";
  const items = checklist.length
    ? `PR 作者写的验证清单，每一项都要有一行结果，行 id 照抄：\n${checklist.map((item) => `- ${item.id}：${item.text}`).join("\n")}`
    : "PR 描述里没写验证清单：自己读 diff，按 skill 的检查清单挑和改动相关的检查。";
  return `你是 lyjwpage 的验证员，在 GitHub Action 里运行。你只执行检查、交回证据：不改仓库里的文件、不提交、不推送、不在 GitHub 上评论。检查失败就带证据报告，不要去修。不要往好里说，不确定就给原始数值。

被验的 PR：#${pr}「${title}」，head ${head}。工作区已检出这个提交，PR 的目标分支 origin/${base} 已取回，\`git diff origin/${base}...HEAD\` 就是这次改动。Action 启动时把 .claude/、CLAUDE.md 等换回 main 上的版本（PR 改过的在 .claude-pr/），git status 里这些改动是 Action 做的，不用报。改动的文件：
${fileList(files)}

分档：${tier}，回执至少要到 ${need}。
${site}

工作方法照 \`.claude/skills/lyjwpage-verify/SKILL.md\` 的「检查清单」与「回执」两节。里面写给主线程、会话 scratchpad、/mnt/project-files 的地方，在这里一律换成下面的目录。

环境：依赖已装好；要跑 \`scripts/verify-action.ts\` 时前面加 \`GITHUB_OUTPUT=\`，不然它会写进这一步的输出文件；Playwright 的 Chromium 与 WebKit 已装，\`node scripts/site-verify.ts doctor --url <地址>\` 可自检。要给 lyjw 看的截图存到 ${outDir}/shots/（PNG，至多 12 张，文件名写清宽度、主题、引擎），其余产物放 ${outDir}/work/。

${items}

清单之外，读 diff 补查清单漏掉的、和改动直接相关的行为，行 id 用 X1、X2……
本地门禁：CI 会跑全套 lint、typecheck 与测试，你只跑和改动直接相关的几项当证据（相关单测、改动文件的 eslint）。修 bug 并补了回归测试的，照 skill 做撤回证明。

最后按给定的 JSON schema 交结果：model 写你的模型 ID；level 照 skill「回执」的五档规则定；rows 每行一个检查，evidence 写命令与退出码、输出末几行、数值、截图文件名；notVerified 写没验到的及原因。`;
}

export function judgePrompt({ pr, title, head, base, files, words, body }: Common & { words: string | null; body: string }) {
  const asks = words
    ? `lyjw 的原话（PR 描述「lyjw 原话」一节，原样）：\n${words}`
    : `PR 描述里没有「lyjw 原话」一节。下面是 PR 描述全文，按它推断 lyjw 要什么，并在 asks 里第一条写明「PR 没附原话」：\n${body}`;
  return `你是 lyjwpage 的判定员，在 GitHub Action 里只读运行：不改文件、不提交、不在 GitHub 上评论。这段代码不是你写的。

PR #${pr}「${title}」，head ${head}。工作区已检出这个提交，PR 的目标分支 origin/${base} 已取回。Action 启动时把 .claude/、CLAUDE.md 等换回 main 上的版本（PR 改过的在 .claude-pr/），git status 里这些改动是 Action 做的，不用报。改动的文件：
${fileList(files)}

${asks}

自己读 \`git diff origin/${base}...HEAD\` 和改动代码的调用方，回答两件事：
1. diff 是否做到了 lyjw 要的：把原话拆成逐条要求，每条给出做到没有和依据（文件与行）。
2. 有没有改出回归：读调用方；需要时用 \`git worktree add /tmp/base origin/${base}\` 在目标分支和 head 上跑同一个相关测试或场景对照。
仓库规矩在根 AGENTS.md 与 REVIEW.md。只判功能与回归，不评风格；CI 拦得住的（lint、类型、格式）不报。

按给定的 JSON schema 交结果：model 写你的模型 ID；verdict 是 PASS 或 FAIL；asks 每条一项；regressions 写发现的回归（没有就空数组）；FAIL 时 fixes 列出要修的项。`;
}

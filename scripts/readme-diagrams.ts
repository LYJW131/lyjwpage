#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { architecture } from "./readme-diagrams/architecture.ts";
import { workflow } from "./readme-diagrams/workflow.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs", "diagrams");

const DIAGRAMS = {
  architecture: {
    draw: architecture,
    title: ["lyjwpage 系统架构", "lyjwpage architecture"],
    description: [
      "采集端经 Cloudflare Access 上报到 ingress Worker，collector Worker 每分钟拉取外部服务；两者写入 core Worker 的 Durable Object 实时层、KV 可滞后快照与 D1 归档，图片进 R2。site Worker 直读 KV、经 Service Binding 读 core 的实时状态与推送，渲染 lyjw.me，中国大陆经阿里云 ESA；对话、MCP 与访客构建交给 AI Worker，它调用模型与 GitHub。",
      "Reporters post through Cloudflare Access to the ingress Worker, and the collector Worker polls outside services every minute. Both write the core Worker's Durable Objects for live state, KV for lag-tolerant snapshots and D1 for the archive; images go to R2. The site Worker reads KV directly and reads live state and pushes from core over Service Bindings to render lyjw.me, fronted by Alibaba ESA in mainland China. Chat, MCP and visitor builds go to the AI Worker, which calls the models and GitHub.",
    ],
  },
  workflow: {
    draw: workflow,
    title: ["lyjwpage 开发工作流", "lyjwpage development workflow"],
    description: [
      "lyjw 在项目聊天里说一句需求，协调 Claude 开线程，线程 Claude 实现后交 Haiku 验证员签回执；改代码的定时任务与访客构建也各自产出 PR，晨报与 Anthropic 动态只出报告。所有改动以 PR 进 main：分支预览、CI 门禁、按需的机器评审与 lyjw 点头之后合并，Workers Builds 自动部署。",
      "lyjw asks in the project chat, a coordinator Claude opens a thread, and the thread's Claude builds the change and has a Haiku verifier sign a receipt. Code-changing routines and visitor builds open PRs as well; the morning brief and the Anthropic digest only report. Every change reaches main as a PR: branch preview, CI gates, bot review when needed and lyjw's OK, then Workers Builds deploys it.",
    ],
  },
} as const;

export function renderAll(): Map<string, string> {
  const files = new Map<string, string>();
  for (const [name, spec] of Object.entries(DIAGRAMS)) {
    for (const lang of ["zh", "en"] as const) {
      const canvas = spec.draw(lang);
      for (const theme of ["light", "dark"] as const) {
        files.set(`${name}-${lang}-${theme}.svg`, canvas.render(theme, spec.title, spec.description));
      }
    }
  }
  return files;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let check = false;
  try {
    check = parseArgs({ options: { check: { type: "boolean", default: false } }, strict: true }).values.check;
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : error}\n用法：node scripts/readme-diagrams.ts [--check]`);
    process.exit(2);
  }
  const files = renderAll();
  const out = path.relative(ROOT, OUT);
  if (check) {
    const stale = [...files]
      .filter(([name, svg]) => {
        const file = path.join(OUT, name);
        return !existsSync(file) || readFileSync(file, "utf8") !== svg;
      })
      .map(([name]) => name);
    if (stale.length > 0) {
      console.error(`${out}/ 与脚本输出不一致：${stale.join("、")}\n跑 pnpm docs:diagrams 重出图后一起提交。`);
      process.exit(1);
    }
    console.log(`${out}/ 下 ${files.size} 张图与脚本输出一致`);
  } else {
    mkdirSync(OUT, { recursive: true });
    for (const [name, svg] of files) writeFileSync(path.join(OUT, name), svg);
    console.log(`写出 ${out}/ 下的 ${files.size} 张图`);
  }
}


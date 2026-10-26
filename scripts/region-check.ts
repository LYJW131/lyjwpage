#!/usr/bin/env node
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "@pinesandbox/computer";

const HELP = `用法：node scripts/region-check.ts [--url https://lyjw.me] [--regions SG,US,DE] [--out region-check]

从 Pine Computer 的住宅出口按地区各开一台临时 Computer，让 Pine 的 agent 像访客一样打开站点，
报图片挂掉、横向溢出、错误文字这类只有真实访客网络才看得到的问题。各地区并行；
结果写 <out>/<地区>/（result.json 与 screenshot.png），有 GITHUB_STEP_SUMMARY 时写汇总表。
退出码 0 全部通过，1 有地区报问题或没跑完。需要 PINECOMPUTER_API_KEY。`;

// 单地区 agent 时长上限：实测一轮完整巡检约 2 分钟，再长就是卡住了，钱照样在花。
const AGENT_WALL_MS = 240_000;

const GOAL = (url: string) => `You are checking the personal site ${url} the way a real visitor in this country sees it. Do not submit forms, send chat messages or follow links that leave the site.
1. Open ${url}, wait 5 seconds, then scroll slowly to the bottom so lazy content loads, then back to the top.
2. Run JavaScript in the page to collect: images with complete && naturalWidth === 0 (their src and the nearest card heading), whether document.documentElement.scrollWidth > clientWidth, and any visible text like "error", "failed", "unavailable".
3. Look at the page yourself for anything that looks broken: blank cards, overlapping or clipped text, alt text showing instead of pictures.
4. Save a screenshot of the first screen as screenshot.png.
5. Write result.json with exactly this shape: {"ok": boolean, "issues": [{"where": "card or area", "what": "what is wrong"}]}. ok is false when issues is not empty. Only list problems you actually observed.`;

type Issue = { where: string; what: string };
type RegionResult = { region: string; state: string; ok: boolean; issues: Issue[]; seconds: number; costUsd?: number; summary?: string };

async function checkRegion(client: Client, url: string, region: string, outDir: string): Promise<RegionResult> {
  const started = Date.now();
  const dir = join(outDir, region);
  mkdirSync(dir, { recursive: true });
  const computer = await client.createComputer({ ephemeral: true, location: { country: region } });
  try {
    const session = await computer.createSession({ browser: true });
    let turn = await session.agent.run(GOAL(url), { constraints: { maxWallMs: AGENT_WALL_MS } });
    while (turn.state === "running" || turn.state === "canceling") {
      turn = await session.agent.wait(turn.turnId, { timeoutMs: 60_000 });
    }
    const result: RegionResult = {
      region,
      state: turn.state,
      ok: false,
      issues: [],
      seconds: Math.round((Date.now() - started) / 1000),
      costUsd: turn.result?.usage?.cost?.total ?? undefined,
      summary: turn.result?.summary,
    };
    for (const file of turn.result?.artifacts ?? []) {
      const name = file.relativePath.split("/").pop()!;
      if (name !== "result.json" && name !== "screenshot.png") continue;
      const bytes = Buffer.from(await session.readFile(file.relativePath));
      writeFileSync(join(dir, name), bytes);
      if (name === "result.json") {
        const parsed = JSON.parse(bytes.toString("utf8")) as { ok?: boolean; issues?: Issue[] };
        result.issues = parsed.issues ?? [];
        result.ok = turn.state === "completed" && parsed.ok === true && result.issues.length === 0;
      }
    }
    return result;
  } finally {
    await computer.kill().catch(() => undefined);
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: "string", default: "https://lyjw.me" },
      regions: { type: "string", default: "SG,US,DE" },
      out: { type: "string", default: "region-check" },
      help: { type: "boolean" },
    },
  });
  if (values.help) return void console.log(HELP);
  const apiKey = process.env.PINECOMPUTER_API_KEY;
  if (!apiKey) throw new Error("PINECOMPUTER_API_KEY is not set");
  const client = new Client({ endpoint: "https://pinesandbox.io", apiKey });
  const regions = values.regions!.split(",").map((r) => r.trim().toUpperCase()).filter(Boolean);

  const settled = await Promise.allSettled(regions.map((r) => checkRegion(client, values.url!, r, values.out!)));
  const results: RegionResult[] = settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : { region: regions[i], state: "error", ok: false, issues: [{ where: "run", what: String(s.reason?.message ?? s.reason) }], seconds: 0 },
  );
  writeFileSync(join(values.out!, "summary.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));

  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = results.map((r) => {
      const issues = r.issues.map((i) => `${i.where}: ${i.what}`).join("<br>") || "—";
      const cost = r.costUsd === undefined ? "—" : `$${r.costUsd.toFixed(3)}`;
      return `| ${r.region} | ${r.ok ? "✅" : "❌"} ${r.state} | ${r.seconds}s | ${cost} | ${issues.replace(/\|/g, "\\|")} |`;
    });
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [`### Region check: ${values.url}`, "", "| Region | Result | Time | Cost | Issues |", "| --- | --- | --- | --- | --- |", ...rows, ""].join("\n"),
    );
  }
  if (!results.every((r) => r.ok)) process.exitCode = 1;
}

await main();

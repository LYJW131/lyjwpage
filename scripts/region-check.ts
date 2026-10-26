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
// Pine 自己按 maxWallMs 收尾；这段余量之后还没到终态就不再等，finally 里 kill 掉止损。
const WAIT_GRACE_MS = 120_000;

const GOAL = (url: string) => `You are checking the personal site ${url} the way a real visitor in this country sees it. Do not submit forms, send chat messages or follow links that leave the site.
1. Open ${url}, wait 5 seconds, then scroll slowly to the bottom so lazy content loads, then back to the top.
2. Run JavaScript in the page to collect: images with complete && naturalWidth === 0 (their src and the nearest card heading), whether document.documentElement.scrollWidth > clientWidth, and any visible text like "error", "failed", "unavailable".
3. For each host that has broken images, open one of its image URLs directly in a new tab. If that tab shows a browser network error (for example ERR_SOCKS_CONNECTION_FAILED, ERR_CONNECTION_*, ERR_NAME_NOT_RESOLVED), this checking machine cannot reach that host at all: put it in "unreachable" instead of "issues". Only list broken images under "issues" when the image URL itself loads or returns an HTTP error page.
4. Look at the page yourself for anything that looks broken: blank cards, overlapping or clipped text, alt text showing instead of pictures.
5. Save a screenshot of the first screen as screenshot.png.
6. Write result.json with exactly this shape: {"ok": boolean, "issues": [{"where": "card or area", "what": "what is wrong"}], "unreachable": ["host"]}. ok is false when issues is not empty. Only list problems you actually observed.`;

type Issue = { where: string; what: string };
type RegionResult = { region: string; state: string; ok: boolean; issues: Issue[]; unreachable?: string[]; seconds: number; costUsd?: number; summary?: string };

async function checkRegion(client: Client, url: string, region: string, outDir: string): Promise<RegionResult> {
  const started = Date.now();
  const dir = join(outDir, region);
  mkdirSync(dir, { recursive: true });
  const computer = await client.createComputer({ ephemeral: true, location: { country: region } });
  try {
    const session = await computer.createSession({ browser: true });
    let turn = await session.agent.run(GOAL(url), { constraints: { maxWallMs: AGENT_WALL_MS } });
    const deadline = Date.now() + AGENT_WALL_MS + WAIT_GRACE_MS;
    while ((turn.state === "running" || turn.state === "canceling") && Date.now() < deadline) {
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
    let reported = false;
    let screenshot = false;
    for (const file of turn.result?.artifacts ?? []) {
      const name = file.relativePath.split("/").pop()!;
      if (name !== "result.json" && name !== "screenshot.png") continue;
      const bytes = Buffer.from(await session.readFile(file.relativePath));
      writeFileSync(join(dir, name), bytes);
      if (name === "screenshot.png") screenshot = bytes.length > 0;
      if (name === "result.json") {
        const parsed = JSON.parse(bytes.toString("utf8")) as { ok?: unknown; issues?: unknown; unreachable?: unknown };
        if (typeof parsed.ok === "boolean" && Array.isArray(parsed.issues)) {
          reported = parsed.ok && parsed.issues.length === 0;
          result.issues = parsed.issues as Issue[];
        } else {
          result.issues.push({ where: "run", what: "result.json does not have ok and issues" });
        }
        result.unreachable = Array.isArray(parsed.unreachable) ? (parsed.unreachable as string[]) : [];
      }
    }
    if (!screenshot) result.issues.push({ where: "run", what: "agent did not deliver screenshot.png" });
    result.ok = turn.state === "completed" && reported && screenshot;
    return result;
  } finally {
    await computer.kill().catch(() => undefined);
  }
}

function usageError(message: string): never {
  console.error(`${message}\n\n${HELP}`);
  process.exit(2);
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      strict: true,
      options: {
        url: { type: "string", default: "https://lyjw.me" },
        regions: { type: "string", default: "SG,US,DE" },
        out: { type: "string", default: "region-check" },
        help: { type: "boolean" },
      },
    }));
  } catch (error) {
    usageError((error as Error).message);
  }
  if (values.help) return void console.log(HELP);
  const regions = values.regions!.split(",").map((r) => r.trim().toUpperCase()).filter(Boolean);
  if (regions.length === 0 || regions.some((r) => !/^[A-Z]{2}$/.test(r))) usageError(`--regions must be two-letter country codes: ${values.regions}`);
  const apiKey = process.env.PINECOMPUTER_API_KEY;
  if (!apiKey) throw new Error("PINECOMPUTER_API_KEY is not set");
  const client = new Client({ endpoint: "https://pinesandbox.io", apiKey });

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
      const unreachable = (r.unreachable ?? []).map((h) => `unreachable from probe: ${h}`);
      const issues = [...r.issues.map((i) => `${i.where}: ${i.what}`), ...unreachable].join("<br>") || "—";
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

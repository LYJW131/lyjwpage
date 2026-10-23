#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { changedPaths, client, isTrustedAuthor, type PrFile, type Pull } from "./pr-gate/github.ts";
import { tierOf } from "./pr-gate/tier.ts";

const USAGE = `用法：node scripts/pr-tier.ts --pr <号>
按改动路径给 PR 分档（scripts/pr-gate/tier.ts#tierOf），输出 name（docs、ui、logic、ui+logic）与 judge，写进 GITHUB_OUTPUT（没有就只打印）。
读 GitHub 用 GITHUB_TOKEN；在 Action 外跑时云端要加 NODE_USE_ENV_PROXY=1。退出码 0 成功、1 读 GitHub 出错、2 参数错。`;

export async function main(argv: string[]) {
  let pr: number;
  try {
    const { values } = parseArgs({ args: argv, strict: true, options: { pr: { type: "string" } } });
    pr = Number(values.pr);
    if (!Number.isInteger(pr) || pr <= 0) throw new Error("缺 --pr");
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  const gh = client(fetch);
  const pull = await gh.get<Pull>(`pulls/${pr}`);
  const tier = tierOf(changedPaths(await gh.all<PrFile>(`pulls/${pr}/files`)), { trustedAuthor: isTrustedAuthor(pull) });
  const lines = [`name=${tier.name}`, `judge=${tier.judge}`];
  console.log(lines.join(" "));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.map((line) => `${line}\n`).join(""));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}

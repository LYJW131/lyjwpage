#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { authorFromTrailer } from "../shared/commit-authors.ts";

// lyjw 定的：少于这么多个非合并提交的 PR 压缩合并，够数的才留合并提交。
export const MERGE_COMMIT_MIN_COMMITS = 3;

export const mergeMethodFor = (commits: number) => (commits >= MERGE_COMMIT_MIN_COMMITS ? "merge" : "squash");

// 只收认得出的身份（agent 或 GitHub noreply）：个人邮箱认不出是谁，可能就是仓库主人自己。
export function mergeMessage({
  number,
  title,
  subjects,
  authors,
  coAuthors,
  owner,
}: {
  number: string | number;
  title: string;
  subjects: string[];
  authors: string[];
  coAuthors: string[];
  owner: string | null;
}) {
  const suffix = `(#${number})`;
  const trimmed = title.trim();
  const commitTitle = trimmed.endsWith(suffix) ? trimmed : `${trimmed} ${suffix}`;
  const seen = new Set<string>();
  const trailers: string[] = [];
  for (const person of [...coAuthors, ...authors]) {
    const match = /^(.*?)\s*<([^>]+)>$/.exec(person.trim());
    if (!match) continue;
    const [, name, email] = match;
    const identity = authorFromTrailer(name, email);
    if (owner && identity.login?.toLowerCase() === owner.toLowerCase()) continue;
    if (!identity.agent && !identity.login) continue;
    const key = `${name} <${email}>`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    trailers.push(`Co-Authored-By: ${name} <${email}>`);
  }
  const summary = subjects.map((subject) => `- ${subject}`).join("\n");
  return {
    commit_title: commitTitle,
    commit_message: [summary, trailers.join("\n")].filter(Boolean).join("\n\n"),
  };
}

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });
const lines = (text: string) => text.split("\n").map((line) => line.trim()).filter(Boolean);

const USAGE = '用法：pnpm merge-message <PR 号> "<PR 标题>" [基线，默认 origin/main]';

export function parseCli(argv: string[]) {
  const { positionals } = parseArgs({ args: argv, strict: true, allowPositionals: true, options: {} });
  const [number, title, base = "origin/main", ...extra] = positionals;
  if (!/^\d+$/.test(number ?? "") || !title?.trim() || extra.length > 0) throw new Error(USAGE);
  return { number, title, base };
}

function main(argv: string[]) {
  let cli: ReturnType<typeof parseCli>;
  try {
    cli = parseCli(argv);
  } catch (error) {
    console.error((error as Error).message === USAGE ? USAGE : `${(error as Error).message}\n${USAGE}`);
    process.exit(2);
  }
  const { number, title, base } = cli;
  const range = `${base}..HEAD`;
  const remote = git("remote", "get-url", "origin").trim();
  const subjects = lines(git("log", "--reverse", "--no-merges", "--format=%s", range));
  const result = mergeMessage({
    number,
    title,
    subjects,
    authors: lines(git("log", "--reverse", "--no-merges", "--format=%an <%ae>", range)),
    coAuthors: lines(git("log", "--reverse", "--format=%(trailers:key=Co-authored-by,valueonly,unfold)", range)),
    owner: /github\.com[/:]([^/]+)\//.exec(remote)?.[1] ?? null,
  });
  if (!result.commit_message) {
    console.error(`${range} 里没有提交，先确认在 PR 分支上并已 git fetch origin main`);
    process.exit(1);
  }
  // 合并接口按它比对 PR 当前 head：验证后又有人推了提交，合并就失败，不会把没验过的代码合进去。
  console.log(JSON.stringify({ ...result, merge_method: mergeMethodFor(subjects.length), expectedHeadSha: git("rev-parse", "HEAD").trim() }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));

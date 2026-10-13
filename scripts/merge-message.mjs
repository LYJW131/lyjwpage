#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { authorFromTrailer } from "../shared/commit-authors.ts";

// 提交作者只收认得出的身份（agent 或 GitHub noreply）：个人邮箱认不出是谁，可能就是仓库主人自己。
export function mergeMessage({ number, title, subjects, authors, coAuthors, owner }) {
  const suffix = `(#${number})`;
  const trimmed = title.trim();
  const commitTitle = trimmed.endsWith(suffix) ? trimmed : `${trimmed} ${suffix}`;
  const seen = new Set();
  const trailers = [];
  const people = [...coAuthors.map((line) => [line, false]), ...authors.map((line) => [line, true])];
  for (const [person, knownOnly] of people) {
    const match = /^(.*?)\s*<([^>]+)>$/.exec(person.trim());
    if (!match) continue;
    const [, name, email] = match;
    const identity = authorFromTrailer(name, email);
    if (owner && identity.login?.toLowerCase() === owner.toLowerCase()) continue;
    if (knownOnly && !identity.agent && !identity.login) continue;
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

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const lines = (text) => text.split("\n").map((line) => line.trim()).filter(Boolean);

function main(argv) {
  const [number, title, base = "origin/main"] = argv;
  if (!/^\d+$/.test(number ?? "") || !title?.trim()) {
    console.error('用法：pnpm merge-message <PR 号> "<PR 标题>" [基线，默认 origin/main]');
    process.exit(2);
  }
  const range = `${base}..HEAD`;
  const remote = git("remote", "get-url", "origin").trim();
  const result = mergeMessage({
    number,
    title,
    subjects: lines(git("log", "--reverse", "--no-merges", "--format=%s", range)),
    authors: lines(git("log", "--reverse", "--no-merges", "--format=%an <%ae>", range)),
    coAuthors: lines(git("log", "--reverse", "--format=%(trailers:key=Co-authored-by,valueonly,unfold)", range)),
    owner: /github\.com[/:]([^/]+)\//.exec(remote)?.[1] ?? null,
  });
  if (!result.commit_message) {
    console.error(`${range} 里没有提交，先确认在 PR 分支上并已 git fetch origin main`);
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));

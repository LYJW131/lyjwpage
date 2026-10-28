import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type PullTarget, reviewWorkspace } from "../lib/workspace.js";
import { gitSource } from "./git-source.js";

export type Label = { kind: string; path: string; line: number | null; title: string; comment: string; reply?: string; reason?: string };
export type Case = PullTarget & {
  id: string;
  split: "train" | "val" | "test";
  gold: { mustFind: Label[]; shouldNotReport: Label[]; later: Label[]; clean?: boolean };
};

export async function loadCases(): Promise<Map<string, Case>> {
  const { cases } = JSON.parse(await readFile(new URL("./data/cases.json", import.meta.url), "utf8")) as { cases: Case[] };
  return new Map(cases.map((c) => [c.id, c]));
}

// 每个用例一份快照，评审员与裁判共用：与线上主机备的文件相同（`lib/workspace.ts#reviewWorkspace`）。
export const WORKSPACES = process.env.REVIEW_EVAL_WORKSPACES ?? "/var/tmp/pr-review-ws";

export async function caseWorkspace(item: Case) {
  const dir = join(WORKSPACES, item.id);
  if (!existsSync(join(dir, "pr/meta.md"))) {
    const files = await reviewWorkspace(gitSource(item), item);
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), content);
    }
  }
  return dir;
}

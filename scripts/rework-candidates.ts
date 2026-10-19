#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const HELP = `用法：node scripts/rework-candidates.ts --from <BASE> --to <NEW> [--window-hours 48]

列出返工账的候选：在 git log --first-parent BASE..NEW 里挑主题是 fix 或 revert 的提交 X，
对 X 相对第一个父提交删掉或改掉的旧行（新增行、新文件、子模块不算），在 X^1 上 git blame，
看这些行由 main 上哪个 first-parent 提交带进来（PR 的合并提交；直推 main 的就是它自己）。
那个提交在 X 之前 --window-hours 小时内（按提交者时间）才列成一对。只读本地 git，在仓库里执行。

输出 JSON：pairs 每项是返工提交 rework、被返工的提交 reworked、涉及的文件与行数；
fixes 是区间里 fix / revert 提交的个数，withoutCandidates 是其中一对都没找到的个数。
根提交与浅克隆边界上 blame 出的行不计；浅克隆的历史没覆盖到窗口起点时报错，先 git fetch --shallow-since 再跑。

退出码：0 正常，1 git 出错或历史不够，2 参数错。`;

const SHANGHAI = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

type Commit = { sha: string; parents: string[]; time: number; subject: string };
type FileChange = { old: string; pathspec: string[] };
export type CommitInfo = { sha: string; subject: string; pr: number | null; committedAt: string; shanghai: string };
export type Pair = {
  rework: CommitInfo;
  reworked: CommitInfo & { hoursBefore: number };
  files: { path: string; lines: number }[];
  lines: number;
};
export type Result = { from: string; to: string; windowHours: number; fixes: number; withoutCandidates: number; pairs: Pair[] };

export const isReworkSubject = (subject: string) => /^fix(\([^)]*\))?!?:/i.test(subject) || /^revert\b/i.test(subject);

export const prNumber = (subject: string) => {
  const match = /\(#(\d+)\)\s*$/.exec(subject);
  return match ? Number(match[1]) : null;
};

function git(repo: string, args: string[]) {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 1 << 28 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} 失败：${(result.stderr || result.error?.message || "").trim()}`);
  return result.stdout;
}

export function resolveCommit(repo: string, ref: string) {
  const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: repo, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function firstParents(repo: string, range: string): Commit[] {
  return git(repo, ["log", "--first-parent", "--format=%H%x1f%P%x1f%ct%x1f%s", range])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, parents, time, subject] = line.split("\x1f");
      return { sha, parents: parents.split(" ").filter(Boolean), time: Number(time), subject };
    });
}

function info(commit: Commit): CommitInfo {
  const at = new Date(commit.time * 1000);
  return { sha: commit.sha, subject: commit.subject, pr: prNumber(commit.subject), committedAt: at.toISOString(), shanghai: SHANGHAI.format(at) };
}

// --raw -z 不转义路径，还带着文件模式，子模块（160000）在这里就能跳过，免得 blame 一个 gitlink 报错。
function changedFiles(repo: string, parent: string, sha: string): FileChange[] {
  const fields = git(repo, ["diff", "--raw", "-z", "-M", "--no-abbrev", parent, sha]).split("\0");
  const files: FileChange[] = [];
  for (let i = 0; i < fields.length; i++) {
    if (!fields[i].startsWith(":")) continue;
    const [srcMode, dstMode, , , status] = fields[i].slice(1).split(" ");
    const renamed = status.startsWith("R") || status.startsWith("C");
    const paths = renamed ? [fields[i + 1], fields[i + 2]] : [fields[i + 1]];
    i += paths.length;
    if (status === "A" || srcMode === "160000" || dstMode === "160000") continue;
    files.push({ old: paths[0], pathspec: paths });
  }
  return files;
}

export function removedRanges(patch: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const line of patch.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+/.exec(line);
    if (!hunk) continue;
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    if (count > 0) ranges.push([Number(hunk[1]), count]);
  }
  return ranges;
}

// blame 不加 --root，根提交与浅克隆边界提交都标 boundary；边界上的行其实来自更早、看不到的历史，所以 boundary 一律不计。
export function blameCounts(porcelain: string) {
  const counts = new Map<string, number>();
  const boundary = new Set<string>();
  let current = "";
  for (const line of porcelain.split("\n")) {
    const header = /^([0-9a-f]{40,64}) \d+ \d+/.exec(line);
    if (header) {
      current = header[1];
      counts.set(current, (counts.get(current) ?? 0) + 1);
    } else if (line === "boundary") {
      boundary.add(current);
    }
  }
  for (const sha of boundary) counts.delete(sha);
  return counts;
}

export function reworkCandidates({ repo, from, to, windowHours }: { repo: string; from: string; to: string; windowHours: number }): Result {
  const window = windowHours * 3600;
  const fromSha = git(repo, ["rev-parse", "--verify", `${from}^{commit}`]).trim();
  const toSha = git(repo, ["rev-parse", "--verify", `${to}^{commit}`]).trim();
  const fixes = firstParents(repo, `${fromSha}..${toSha}`).filter((commit) => isReworkSubject(commit.subject)).reverse();
  const result: Result = { from: fromSha, to: toSha, windowHours, fixes: fixes.length, withoutCandidates: 0, pairs: [] };
  if (fixes.length === 0) return result;

  const earliest = Math.min(...fixes.map((fix) => fix.time)) - window;
  const chain = firstParents(repo, toSha);
  if (git(repo, ["rev-parse", "--is-shallow-repository"]).trim() === "true") {
    const oldest = Math.min(...chain.map((commit) => commit.time));
    if (oldest > earliest) {
      const since = new Date(earliest * 1000).toISOString();
      throw new Error(`浅克隆的 first-parent 历史最早到 ${new Date(oldest * 1000).toISOString()}，没覆盖窗口起点 ${since}：先 git fetch --shallow-since=${since} 再跑`);
    }
  }
  const introducedBy = new Map<string, Commit>();
  for (const commit of chain) {
    if (commit.time < earliest) continue;
    const parent = commit.parents[0];
    const introduced = parent ? git(repo, ["rev-list", `${parent}..${commit.sha}`]).split("\n").filter(Boolean) : [commit.sha];
    for (const sha of introduced) introducedBy.set(sha, commit);
  }

  for (const fix of fixes) {
    const parent = fix.parents[0];
    const hits = new Map<string, { commit: Commit; files: Map<string, number> }>();
    for (const file of parent ? changedFiles(repo, parent, fix.sha) : []) {
      const patch = git(repo, ["--literal-pathspecs", "diff", "-U0", "-M", "--no-color", "--no-ext-diff", "--no-textconv", parent, fix.sha, "--", ...file.pathspec]);
      const ranges = removedRanges(patch);
      if (ranges.length === 0) continue;
      const porcelain = git(repo, ["-c", "blame.showRoot=false", "blame", "--porcelain", ...ranges.flatMap(([start, count]) => ["-L", `${start},+${count}`]), parent, "--", file.old]);
      for (const [sha, lines] of blameCounts(porcelain)) {
        const origin = introducedBy.get(sha);
        if (!origin || origin.sha === fix.sha || fix.time - origin.time > window) continue;
        const hit = hits.get(origin.sha) ?? { commit: origin, files: new Map<string, number>() };
        hit.files.set(file.old, (hit.files.get(file.old) ?? 0) + lines);
        hits.set(origin.sha, hit);
      }
    }
    if (hits.size === 0) result.withoutCandidates += 1;
    const pairs = [...hits.values()].map(({ commit, files }) => {
      const list = [...files].map(([path, lines]) => ({ path, lines })).sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
      return {
        rework: info(fix),
        reworked: { ...info(commit), hoursBefore: Math.round(((fix.time - commit.time) / 3600) * 10) / 10 },
        files: list,
        lines: list.reduce((sum, file) => sum + file.lines, 0),
      };
    });
    result.pairs.push(...pairs.sort((a, b) => b.lines - a.lines));
  }
  return result;
}

function main(argv: string[]) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: { from: { type: "string" }, to: { type: "string" }, "window-hours": { type: "string", default: "48" }, help: { type: "boolean" } },
    }));
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n\n${HELP}`);
    return 2;
  }
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const windowHours = Number(values["window-hours"]);
  if (!values.from || !values.to || !Number.isFinite(windowHours) || windowHours <= 0) {
    console.error(HELP);
    return 2;
  }
  const repo = process.cwd();
  for (const ref of [values.from, values.to]) {
    if (resolveCommit(repo, ref)) continue;
    console.error(`认不出提交 ${ref}（在仓库里执行，浅克隆先取够历史）`);
    return 2;
  }
  try {
    console.log(JSON.stringify(reworkCandidates({ repo, from: values.from, to: values.to, windowHours }), null, 2));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = main(process.argv.slice(2));

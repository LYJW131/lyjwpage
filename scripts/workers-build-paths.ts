import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { object } from "../shared/json.ts";

export type WatchPaths = { includes: string[]; excludes: string[] };
export type BuildPaths = { productionBranch: string; workers: Record<string, WatchPaths> };
export type ChangedFiles = { base: string; files: string[]; commitCount: number };
const ROOT = fileURLToPath(new URL("../", import.meta.url));

function patterns(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0 && !/[?[\]{}!\\]/.test(item))) {
    throw new Error("监视路径必须是非空字符串数组，只支持静态路径与 * 通配符");
  }
  return value;
}

export function parseBuildPaths(value: unknown): BuildPaths {
  const config = object(value);
  const workers = object(config?.workers);
  if (typeof config?.productionBranch !== "string" || !config.productionBranch || !workers || !Object.keys(workers).length) {
    throw new Error("监视路径配置缺少 productionBranch 或 workers");
  }
  return {
    productionBranch: config.productionBranch,
    workers: Object.fromEntries(Object.entries(workers).map(([worker, value]) => {
      const paths = object(value);
      if (!/^[a-z][a-z0-9-]*$/.test(worker) || !paths) throw new Error(`无效 Worker：${worker}`);
      return [worker, { includes: patterns(paths.includes), excludes: patterns(paths.excludes) }];
    })),
  };
}

export function loadBuildPaths(): BuildPaths {
  return parseBuildPaths(JSON.parse(readFileSync(new URL("./workers-build-paths.json", import.meta.url), "utf8")));
}

// Cloudflare 的 * 跨越目录分隔符；excludes 优先，不能换成文件系统 glob 的单星号语义。
export function matchesPath(file: string, pattern: string): boolean {
  const expression = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${expression}$`, "s").test(file);
}

export function expectedWorkers(changes: ChangedFiles, config: BuildPaths): string[] {
  const files = [...new Set(changes.files)];
  // 空推送与大推送由 Cloudflare 强制构建全部 Worker，不经过路径过滤。
  const all = files.length === 0 || files.length >= 3000 || changes.commitCount >= 20;
  return Object.entries(config.workers).filter(([, paths]) => all || files.some((file) =>
    !paths.excludes.some((pattern) => matchesPath(file, pattern)) && paths.includes.some((pattern) => matchesPath(file, pattern)),
  )).map(([worker]) => worker).sort();
}

export function gitChangedFiles(sha: string, before?: string, cwd = ROOT): ChangedFiles {
  if (!/^[0-9a-f]{40}$/.test(sha) || (before !== undefined && !/^[0-9a-f]{40}$/.test(before))) throw new Error("提交必须是完整 SHA");
  const git = (args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  const base = before ?? git(["rev-parse", "--verify", `${sha}^1`]).trim();
  git(["merge-base", "--is-ancestor", base, sha]);
  if (base === sha) throw new Error("推送前后的提交相同");
  const files = git(["diff", "--name-only", "--no-renames", "-z", base, sha, "--"]).split("\0").filter(Boolean);
  const commitCount = Number(git(["rev-list", "--count", `${base}..${sha}`]).trim());
  if (!Number.isSafeInteger(commitCount) || commitCount < 1) throw new Error("无法确认推送提交数");
  return { base, files, commitCount };
}

export function compareBuildPaths(snapshot: unknown, config = loadBuildPaths()): string[] {
  if (!Array.isArray(snapshot)) throw new Error("远端快照必须是 Worker 配置数组");
  const differences: string[] = [];
  const seen = new Set<string>();
  for (const item of snapshot) {
    const row = object(item);
    if (typeof row?.worker !== "string") throw new Error("远端快照缺少 worker");
    const worker = row.worker;
    if (seen.has(worker)) throw new Error(`远端快照重复 Worker：${worker}`);
    seen.add(worker);
    const expected = config.workers[worker];
    if (!expected) { differences.push(`${worker} 未登记在本地配置`); continue; }
    if (row.branch !== config.productionBranch) differences.push(`${worker} 生产分支不一致`);
    for (const key of ["includes", "excludes"] as const) {
      const actual = patterns(row[key]);
      if (JSON.stringify([...new Set(actual)].sort()) !== JSON.stringify([...new Set(expected[key])].sort())) differences.push(`${worker} ${key} 不一致`);
    }
  }
  for (const worker of Object.keys(config.workers)) if (!seen.has(worker)) differences.push(`${worker} 缺少远端配置`);
  return differences;
}

function main() {
  let snapshot: string;
  try {
    const { values } = parseArgs({ options: { snapshot: { type: "string" }, help: { type: "boolean" } }, strict: true });
    if (values.help) { console.log("用法：node scripts/workers-build-paths.ts --snapshot <Cloudflare Code Mode 导出的 JSON>\n快照每项：worker、branch、includes、excludes；仅比对，不修改远端配置。"); return 0; }
    if (!values.snapshot) throw new Error("需要 --snapshot <JSON 文件>");
    snapshot = values.snapshot;
  } catch (error) {
    console.log(JSON.stringify({ pass: false, next: String(error) }));
    return 2;
  }
  try {
    const differences = compareBuildPaths(JSON.parse(readFileSync(snapshot, "utf8")));
    console.log(JSON.stringify({ pass: differences.length === 0, differences }, null, 2));
    return differences.length ? 1 : 0;
  } catch (error) {
    console.log(JSON.stringify({ pass: false, next: String(error) }));
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = main();

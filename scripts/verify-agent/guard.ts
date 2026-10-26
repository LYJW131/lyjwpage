import fs from "node:fs";
import path from "node:path";

// bash 与测试跑的是 PR 的代码：名字像凭据的变量一律不给，GitHub 的输出文件也不给（不然 PR 代码能改写这一步的结果）
const SECRET_ENV = /TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|^ACTIONS_ID_TOKEN|^ACTIONS_RUNTIME|^GITHUB_OUTPUT$|^GITHUB_STEP_SUMMARY$|^GITHUB_ENV$|^GITHUB_PATH$/i;

export function childEnv(env: Record<string, string | undefined>, tmpDir: string) {
  const out: Record<string, string | undefined> = { TMPDIR: tmpDir };
  for (const [key, value] of Object.entries(env)) if (!SECRET_ENV.test(key) && key !== "TMPDIR") out[key] = value;
  return out;
}

export function inside(dir: string, target: string) {
  const rel = path.relative(dir, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

const FORBIDDEN_READ = [/^\/proc(\/|$)/, /^\/sys(\/|$)/, /\/\.config\/gh(\/|$)/, /\/\.git-credentials$/, /\/\.env(\.[^/]*)?$/, /\/\.dev\.vars$/];

// bash 能在仓库与产物目录里建符号链接（比如指向 /proc/self/environ），守卫一律按解开链接后的真实路径判
export function realPath(target: string, depth = 0): string {
  try {
    return fs.realpathSync(target);
  } catch {
    if (depth > 40) return target;
    const link = fs.lstatSync(target, { throwIfNoEntry: false });
    if (link?.isSymbolicLink()) return realPath(path.resolve(path.dirname(target), fs.readlinkSync(target)), depth + 1);
    const parent = path.dirname(target);
    return parent === target ? target : path.join(realPath(parent, depth + 1), path.basename(target));
  }
}

export const forbiddenRead = (target: string) => [target, realPath(target)].some((candidate) => FORBIDDEN_READ.some((pattern) => pattern.test(candidate)));

export const realInside = (dir: string, target: string) => inside(dir, target) && inside(realPath(dir), realPath(target));

// read / grep / find / ls 跑在 runner 进程里、不进 bwrap：只许读点名的根目录，grep 或 find 从 / 递归就进得了 /proc/<pid>/environ
export const readAllowed = (roots: string[], target: string) => roots.some((root) => realInside(root, target)) && !forbiddenRead(target);

export const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

export function sandboxed(command: string, writable: string[], bwrap: boolean) {
  if (!bwrap) return command;
  const binds = writable.map((dir) => `--bind ${quote(dir)} ${quote(dir)}`).join(" ");
  return `exec bwrap --ro-bind / / ${binds} --dev /dev --proc /proc --unshare-pid --die-with-parent bash -c ${quote(command)}`;
}

// 黑名单只判 path 参数时，grep 从允许的根往下递归仍会搜进 .env* 这类文件：结果里来自它们的行一律去掉
export function filterGrepOutput(text: string, searchDir: string): { text: string; dropped: number } {
  let dropped = 0;
  const kept = text.split("\n").filter((line) => {
    const match = /^(.+?)[:-]\d+[:-]/.exec(line);
    if (!match || !forbiddenRead(path.resolve(searchDir, match[1]))) return true;
    dropped++;
    return false;
  });
  return { text: kept.join("\n"), dropped };
}

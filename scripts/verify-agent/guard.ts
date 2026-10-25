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

export const forbiddenRead = (target: string) => FORBIDDEN_READ.some((pattern) => pattern.test(target));

export const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

export function sandboxed(command: string, writable: string[], bwrap: boolean) {
  if (!bwrap) return command;
  const binds = writable.map((dir) => `--bind ${quote(dir)} ${quote(dir)}`).join(" ");
  return `exec bwrap --ro-bind / / ${binds} --dev /dev --proc /proc --unshare-pid --die-with-parent bash -c ${quote(command)}`;
}

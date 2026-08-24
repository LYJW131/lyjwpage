import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { config } from "./config.js";

/**
 * token 状态文件。
 *
 * 存在的唯一理由：refresh token 寿命约两个月，重启后能接着用它续 access token，
 * 不必每次都让人去浏览器里重新抠一串 NPSSO。
 *
 * 三条纪律：
 * 1. **0600**，而且是「先写临时文件再 rename」—— rename 是原子的，进程在写一半时
 *    被 docker 干掉不会留下半份 JSON 把下次启动坑死。mode 跟着 inode 走，
 *    rename 之后仍是 0600。
 * 2. 目录进 .gitignore（同目录那份），文件本身也不许拷进镜像。
 * 3. 里面是明文 token，**任何日志都不许打印它的内容** —— 这个模块只导出读写，
 *    不导出任何会 stringify 整份状态的东西。
 */

export type AuthState = {
  accessToken: string;
  refreshToken: string;
  /**
   * 四个时刻都是 epoch 毫秒（AGENTS.md 第 4 条：同一概念同名同单位）。
   *
   * 上游给的是 `expires_in` / `refresh_token_expires_in` 两个**秒数**，
   * 换算和落点在这一侧做完 —— 只存到期时刻的话，续期就没法判半衰期：
   * 「我什么时候收到的」和「它什么时候签发的」不是一回事。
   */
  accessTokenIssuedAt: number;
  accessTokenExpiresAt: number;
  refreshTokenIssuedAt: number;
  refreshTokenExpiresAt: number;
};

function statePath() {
  return resolve(config.stateFile);
}

function isState(value: unknown): value is AuthState {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  const strings = ["accessToken", "refreshToken"] as const;
  const numbers = [
    "accessTokenIssuedAt",
    "accessTokenExpiresAt",
    "refreshTokenIssuedAt",
    "refreshTokenExpiresAt",
  ] as const;
  return (
    strings.every((key) => typeof row[key] === "string" && row[key] !== "") &&
    numbers.every((key) => typeof row[key] === "number" && Number.isFinite(row[key]))
  );
}

/** 读不到、读坏了、格式不对，一律当作「没有」—— 调用方会退回 NPSSO 那条路 */
export async function readState(): Promise<AuthState | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(statePath(), "utf8"));
    return isState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeState(state: AuthState): Promise<void> {
  const path = statePath();
  // 目录也收紧到 0700：文件是 0600，但目录默认 0755 的话同机别的用户至少能看见
  // 它叫什么、什么时候被换过
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  // mode 给在 writeFile 上，别指望之后再 chmod —— 中间那一瞬文件是 0644 的。
  // 已经存在的临时文件不会被 writeFile 重新应用 mode，所以补一次 chmod 兜底
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

/**
 * 半衰期哲学：过了「签发 → 到期」的中点就换新的。
 *
 * 和 workers/musickit-token 那份 `pastHalfLife` 是同一条规则，也是同一个理由 ——
 * 寿命不由上游承诺（PSN 现在给的 access token 约一小时、refresh 约两个月，都是
 * 观测值不是合同），写死一个提前量在两个方向上都可能错：寿命变短就来不及，
 * 变长就白白多换几次。
 */
export function pastHalfLife(issuedAt: number, expiresAt: number, now = Date.now()): boolean {
  if (!(expiresAt > issuedAt)) return true;
  return now >= issuedAt + (expiresAt - issuedAt) / 2;
}

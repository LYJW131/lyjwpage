import { open } from "node:fs/promises";
import { access } from "node:fs/promises";
import path from "node:path";

import { info } from "../log.js";

/**
 * Antigravity 刷新 token 要的 OAuth client_id / client_secret 是 `agy` 二进制里的常量，
 * 登录后落盘的 token 文件里没有。镜像里本来就装着 `agy`，所以不让人手抄：
 * 启动时把二进制扫一遍，把长得像 Google OAuth client 的字符串都捞出来当候选。
 *
 * 二进制里各有两个候选（IDE 一套、CLI 一套），Go 打包的字符串没有分隔符，光看
 * 位置分不清谁配谁 —— 所以这里只出候选，配对由刷新时逐对试出来（错的那对 Google
 * 回 401 invalid_client），见 antigravity.ts 的 pickWorkingClient。
 *
 * 环境变量 ANTIGRAVITY_OAUTH_CLIENT_ID / SECRET 配了就直接用，不扫。
 */
export type OAuthClient = { clientId: string; clientSecret: string };

const ID_PATTERN = /\d{10,14}-[a-z0-9]{32}\.apps\.googleusercontent\.com/g;
const SECRET_PATTERN = /GOCSPX-[A-Za-z0-9_-]{28}/g;
/** 4 MiB 一块、块间留 256 字节重叠，常量不会被切在边界上 */
const CHUNK = 4 * 1024 * 1024;
const OVERLAP = 256;

async function resolveBinary(bin: string): Promise<string | null> {
  if (bin.includes("/")) {
    try {
      await access(bin);
      return bin;
    } catch {
      return null;
    }
  }
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, bin);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // 下一个
    }
  }
  return null;
}

export async function scanOAuthClientCandidates(bin: string): Promise<OAuthClient[]> {
  const file = await resolveBinary(bin);
  if (!file) return [];
  const ids = new Set<string>();
  const secrets = new Set<string>();
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(CHUNK + OVERLAP);
    let position = 0;
    let carry = Buffer.alloc(0);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, CHUNK, position);
      if (bytesRead === 0) break;
      const chunk = Buffer.concat([carry, buffer.subarray(0, bytesRead)]).toString("latin1");
      for (const match of chunk.match(ID_PATTERN) ?? []) ids.add(match);
      for (const match of chunk.match(SECRET_PATTERN) ?? []) secrets.add(match);
      carry = Buffer.from(chunk.slice(-OVERLAP), "latin1");
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  const pairs: OAuthClient[] = [];
  for (const clientId of ids) {
    for (const clientSecret of secrets) pairs.push({ clientId, clientSecret });
  }
  if (pairs.length > 0) {
    info(`从 ${file} 扫出 ${ids.size} 个 client_id、${secrets.size} 个 client_secret，刷新时逐对试`);
  }
  return pairs;
}

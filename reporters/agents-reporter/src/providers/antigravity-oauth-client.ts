import { open } from "node:fs/promises";
import { access } from "node:fs/promises";
import path from "node:path";

import { info } from "../log.js";

// Go 二进制中的字符串位置不能确定 OAuth id 与 secret 的配对，必须逐对验证候选。
export type OAuthClient = { clientId: string; clientSecret: string };

const ID_PATTERN = /\d{10,14}-[a-z0-9]{32}\.apps\.googleusercontent\.com/g;
const SECRET_PATTERN = /GOCSPX-[A-Za-z0-9_-]{28}/g;
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

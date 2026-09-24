import { access, open } from "node:fs/promises";
import path from "node:path";

import { config } from "./config.js";
import { info } from "./log.js";

export type ClaudeOAuthClient = { tokenUrl: string; clientId: string };

/**
 * Claude Code 2.1.261 的原生安装包仍内嵌生产 OAuth 配置对象。
 * 只读取 BASE_API_URL 指向生产 API、OAUTH_FILE_SUFFIX 为空的完整配置，
 * 不执行安装包代码，也不把其它客户端（例如 Claude Design）的 ID 当成候选试用。
 */
export function parseClaudeOAuthClients(source: string): ClaudeOAuthClient[] {
  const blocks = source.matchAll(
    /\{\s*BASE_API_URL\s*:\s*"https:\/\/api\.anthropic\.com"[\s\S]{0,8192}?\bOAUTH_FILE_SUFFIX\s*:\s*""/g,
  );
  const clients: ClaudeOAuthClient[] = [];
  for (const [block] of blocks) {
    const tokenUrl = /(?:^|,)\s*TOKEN_URL\s*:\s*"([^"]+)"/.exec(block)?.[1];
    const clientId = /(?:^|,)\s*CLIENT_ID\s*:\s*"([a-f0-9-]{36})"/i.exec(block)?.[1];
    if (!tokenUrl || !clientId) continue;
    const url = new URL(tokenUrl);
    if (url.protocol !== "https:" || url.hostname !== "platform.claude.com" ||
        url.pathname !== "/v1/oauth/token" || url.search || url.hash || url.port ||
        url.username || url.password) continue;
    clients.push({ tokenUrl, clientId });
  }
  return clients;
}

async function resolveBinary(bin: string): Promise<string> {
  const candidates = bin.includes("/") ? [bin] :
    (process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, bin));
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // 继续找 PATH 中的下一项。
    }
  }
  throw new Error("找不到 Claude Code 安装程序，请检查 CLAUDE_BIN");
}

/** 分块读原生程序，避免把整个数百 MB 的二进制载入内存。重叠覆盖完整配置对象。 */
export async function scanClaudeOAuthClient(bin: string): Promise<ClaudeOAuthClient> {
  const handle = await open(await resolveBinary(bin), "r");
  const clients = new Map<string, ClaudeOAuthClient>();
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let carry = "";
    for (;;) {
      const { bytesRead } = await handle.read(buffer);
      if (!bytesRead) break;
      const source = carry + buffer.subarray(0, bytesRead).toString("latin1");
      for (const client of parseClaudeOAuthClients(source)) {
        clients.set(JSON.stringify(client), client);
      }
      carry = source.slice(-16 * 1024);
    }
  } finally {
    await handle.close();
  }
  if (clients.size !== 1) {
    throw new Error("无法唯一识别 Claude Code 的生产 OAuth 配置，请更新扫描规则或配置 CLAUDE_OAUTH_TOKEN_URL / CLAUDE_OAUTH_CLIENT_ID");
  }
  return [...clients.values()][0]!;
}

let discovered: Promise<ClaudeOAuthClient> | undefined;

export function getClaudeOAuthClient(): Promise<ClaudeOAuthClient> {
  const { tokenUrl, clientId } = config.claudeOAuth;
  if (tokenUrl || clientId) {
    if (!tokenUrl || !clientId) {
      return Promise.reject(new Error("CLAUDE_OAUTH_TOKEN_URL / CLAUDE_OAUTH_CLIENT_ID 必须一起配置"));
    }
    return Promise.resolve({ tokenUrl, clientId });
  }
  return discovered ??= scanClaudeOAuthClient(config.claudeBin).then((client) => {
    info("已从 Claude Code 安装程序读取生产 OAuth 配置");
    return client;
  }).catch((error) => {
    discovered = undefined;
    throw error;
  });
}

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");

// Cloudflare 文档公开的 Turnstile 测试密钥，不是凭据。
const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";

const secret = () => randomBytes(32).toString("base64url");

export function cloudDevFiles(env, makeSecret = secret) {
  const apiExample = fs.readFileSync(path.join(ROOT, "workers/api/.dev.vars.example"), "utf8");
  const ai = [
    `ANTHROPIC_API_KEY=${env.LYJWPAGE_ANTHROPIC_API_KEY ?? ""}`,
    `TURNSTILE_SECRET_KEY=${TURNSTILE_TEST_SECRET}`,
    `CHAT_HISTORY_SECRET=${makeSecret()}`,
    `BUILD_SESSION_SECRET=${makeSecret()}`,
    "ALLOWED_ORIGINS=http://localhost:3211",
  ];
  return {
    "workers/api/.dev.vars": apiExample,
    "workers/ai/.dev.vars": `${ai.join("\n")}\n`,
    ".env.local": `PUBLIC_TURNSTILE_SITE_KEY=${TURNSTILE_TEST_SITE_KEY}\n`,
  };
}

function main() {
  for (const [relative, content] of Object.entries(cloudDevFiles(process.env))) {
    const file = path.join(ROOT, relative);
    if (fs.existsSync(file)) continue;
    fs.writeFileSync(file, content, { mode: 0o600 });
    console.log(`[cloud-dev-vars] 生成 ${relative}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");

const secret = () => randomBytes(32).toString("base64url");

export function cloudDevFiles(env, makeSecret = secret) {
  const apiExample = fs.readFileSync(path.join(ROOT, "workers/core/.dev.vars.example"), "utf8");
  const ai = [
    `ANTHROPIC_API_KEY=${env.LYJWPAGE_ANTHROPIC_API_KEY ?? ""}`,
    `DEEPSEEK_API_KEY=${env.LYJWPAGE_DEEPSEEK_API_KEY ?? ""}`,
    `CHAT_HISTORY_SECRET=${makeSecret()}`,
    `BUILD_SESSION_SECRET=${makeSecret()}`,
    "ALLOWED_ORIGINS=http://localhost:3211",
  ];
  return {
    "workers/core/.dev.vars": apiExample,
    "workers/ai/.dev.vars": `${ai.join("\n")}\n`,
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

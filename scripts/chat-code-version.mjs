import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// 这些路径的内容一变，访客就得重新同意对话的隐私说明；测试文件不算。
export const CHAT_CODE_PATHS = [
  "src/components/god-chat.tsx",
  "src/components/chat-card.tsx",
  "src/components/chat-markdown.tsx",
  "src/components/build-plan-card.tsx",
  "src/components/github-issue-panel.tsx",
  "src/lib/chat-archive.ts",
  "src/lib/chat-consent.ts",
  "shared/god-chat.ts",
  "shared/god-chat-tiers.ts",
  "shared/build-routine.ts",
  "shared/github-issue.ts",
  "workers/ai/src",
];

const isTest = (path) => /\.test\.[cm]?[jt]sx?$/.test(path);

function files(root, path) {
  const full = join(root, path);
  if (!statSync(full).isDirectory()) return [path];
  return readdirSync(full).flatMap((name) => files(root, join(path, name)));
}

export function chatCodeVersion(root) {
  const hash = createHash("sha256");
  const paths = CHAT_CODE_PATHS.flatMap((path) => files(root, path))
    .map((path) => relative(root, join(root, path)).split(sep).join("/"))
    .filter((path) => !isTest(path))
    .sort();
  for (const path of paths) hash.update(path).update("\0").update(readFileSync(join(root, path))).update("\0");
  return hash.digest("hex").slice(0, 16);
}

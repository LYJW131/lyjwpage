import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { ESLint } from "eslint";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const eslint = new ESLint({ cwd: root });

const ruleIds = async (filePath, code) =>
  (await eslint.lintText(code, { filePath })).flatMap((result) => result.messages.map((message) => message.ruleId));

test("src/ 组件里手写 <img> 被 no-restricted-syntax 拦下", async () => {
  const results = await eslint.lintText(`export const X = () => <img src="/img/a.webp" alt="" />;`, { filePath: "src/components/x.tsx" });
  const hits = results.flatMap((result) => result.messages).filter((message) => message.ruleId === "no-restricted-syntax");
  assert.equal(hits.length, 1);
  assert.match(hits[0].message, /app-image/);
});

test("走 AppImage 的写法不拦；app-image.tsx 自己的 <img> 豁免", async () => {
  const ids = await ruleIds(
    "src/components/x.tsx",
    `import Image from "@/components/app-image";\nexport const X = () => <Image src="/img/a.webp" alt="" unoptimized />;`,
  );
  assert.ok(!ids.includes("no-restricted-syntax"));

  const inner = await ruleIds("src/components/app-image.tsx", `export const X = () => <img src="/img/a.webp" alt="" />;`);
  assert.ok(!inner.includes("no-restricted-syntax"));
});

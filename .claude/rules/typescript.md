---
paths:
  - "**/package.json"
  - "**/tsconfig*.json"
  - "eslint.config.mjs"
---

# TypeScript 版本

- 根 `package.json` 的 `typescript` 是 `@typescript/typescript6` 的别名，`tsc` 来自 `@typescript/native`（TypeScript 7 原生编译器）：typescript-eslint 与 `scripts/comment-only-check.test.ts` 要 6.0 的 JS API，TypeScript 7 没有。两项不要合并；Worker 与上报器目录只跑 `tsc`，直接依赖 `typescript` 7。

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 推送代理是独立的 Node 包，跑在 NAS 上，别拿站点的前端规则去量它
    "reporters/**",
    // 后台 agent 的临时 worktree 挂在这里，里面各有一份 node_modules，不扫
    ".claude/**",
  ]),
]);

export default eslintConfig;

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}", "shared/**/*.ts"],
    rules: {
      // 站点和共用读取模块不能重新引入 Worker 的写入、发布与采集实现。
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@api/*", "**/workers/api/**"],
          message: "上报写入和实时发布只属于 Worker；共享类型、键和计算放在 shared。",
        }, {
          group: ["**/workers/collector/**"],
          message: "定时采集只属于采集 Worker；共享类型、键和契约放在 shared（如 shared/collector.ts）。",
        }, {
          group: ["**/workers/ingress/**"],
          message: "上报鉴权与拆分只属于上报入口 Worker；prepare 放在 shared/ingest，契约放在 shared/state-core.ts。",
        }],
      }],
    },
  },
  {
    // 状态核心只 import 上报命令的类型：校验与收敛的实现在上报入口，改它们不该重新发布
    // 带 Durable Object 的 api Worker（Workers Builds 的监视路径据此排除 shared/ingest，见 docs/workers-builds.md）
    files: ["workers/api/src/**/*.ts"],
    ignores: ["workers/api/src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [{
          group: ["@shared/ingest/*"],
          allowTypeImports: true,
          message: "状态核心只收 prepare 好的命令：从 shared/ingest 只能 import type，校验放在上报入口。",
        }],
      }],
    },
  },
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
    // 讲解动画是独立的静态页面和渲染脚本（浏览器全局 + 本机 Chrome），不走站点的前端规则
    "docs/explainer/**",
    "public/explainer/**",
  ]),
]);

export default eslintConfig;

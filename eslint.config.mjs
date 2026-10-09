import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}", "shared/**/*.ts"],
    rules: {
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
        }, {
          group: ["**/workers/ai/**"],
          message: "模型调用与工具编排只属于 AI Worker；浏览器契约放在 shared。",
        }],
      }],
    },
  },
  {
    // 上报校验不能进入状态核心运行依赖，否则会绕过 Workers Builds 的监视路径隔离。
    files: ["workers/api/src/**/*.ts"],
    ignores: ["workers/api/src/**/*.test.ts", "workers/api/src/preview-entry.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [{
          group: ["@shared/ingest/*"],
          allowTypeImports: true,
          message: "状态核心只收 prepare 好的命令：从 shared/ingest 只能 import type，校验放在上报入口。",
        }, {
          group: ["**/ai/src/**", "@shared/god-chat", "@shared/god-chat-tiers", "@shared/github-issue", "@shared/build-routine", "@shared/mcp"],
          message: "状态核心不打包 AI 实现或对话契约；HTTP 转发只依赖 shared/ai-paths，预览组合入口除外。",
        }],
      }],
    },
  },
  {
    files: ["workers/ai/src/**/*.ts"],
    ignores: ["workers/ai/src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@api/*", "**/api/src/**", "@/lib/storage-driver", "@/lib/status-loaders", "@shared/state-core"],
          message: "AI 只能通过 PublicStatus 读取公开模型，不能导入状态核心或存储实现。",
        }],
      }],
    },
  },
  globalIgnores([
    ".next/**",
    "**/.wrangler/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "reporters/**",
    ".claude/**",
    "docs/explainer/**",
    "public/explainer/**",
  ]),
]);

export default eslintConfig;

import { fixupPluginRules } from "@eslint/compat";
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// eslint-plugin-react 与 jsx-a11y 仍调用 ESLint 10 已删除的 context 方法（如 getFilename），由 @eslint/compat 补上。
const withFixedPlugin = (config, name, plugin) => ({ ...config, plugins: { ...config.plugins, [name]: fixupPluginRules(plugin) } });

const COPYING_ARRAY_METHODS = {
  selector: "CallExpression > MemberExpression.callee[property.name=/^(toSorted|toReversed|toSpliced)$/]",
  message: "客户端构建不补 polyfill，Safari 16 以下、Chrome 110 以下没有这三个方法，渲染直接抛错：先 [...arr] 拷贝再 sort / reverse / splice。",
};

const eslintConfig = defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { globals: { ...globals.node, WebSocket: "readonly" } },
  },
  {
    files: ["public/sw.js"],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    files: ["**/*.{ts,tsx,mts}"],
    extends: [
      withFixedPlugin(react.configs.flat.recommended, "react", react),
      withFixedPlugin(react.configs.flat["jsx-runtime"], "react", react),
      reactHooks.configs.flat["recommended-latest"],
      withFixedPlugin(jsxA11y.flatConfigs.recommended, "jsx-a11y", jsxA11y),
    ],
    rules: { "jsx-a11y/no-noninteractive-tabindex": "off" },
    settings: { react: { version: "detect" } },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@core/*", "**/workers/core/**"],
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
        }, {
          group: [
            "@shared/storage", "@shared/cache", "@shared/lag", "@shared/lag-result", "@shared/apple-music-auth", "@shared/apple-cache",
            "**/shared/storage", "**/shared/cache", "**/shared/lag", "**/shared/lag-result", "**/shared/apple-music-auth", "**/shared/apple-cache",
          ],
          message: "这些模块要 Worker 入口先 install 端口，站点里没人安装，调用即抛错；状态经 core Worker 读。",
        }],
      }],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/app-image.tsx"],
    rules: {
      "no-restricted-syntax": ["error", {
        selector: "JSXOpeningElement[name.name='img']",
        message: "站点组件不手写 <img>：用 @/components/app-image（懒加载、rest-ready 门控、优化器）；静态图标记得带 unoptimized。",
      }, COPYING_ARRAY_METHODS],
    },
  },
  {
    files: ["src/components/app-image.tsx"],
    rules: {
      "no-restricted-syntax": ["error", COPYING_ARRAY_METHODS],
    },
  },
  {
    files: ["shared/**/*.{ts,mts}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@core/*", "**/workers/core/**"],
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
        }, {
          group: ["@/*"],
          message: "src/ 只放站点代码；Worker 与 shared 用到的模块放进 shared 或所属 Worker。",
        }],
      }],
    },
  },
  {
    files: ["workers/{core,ai,ingress,collector,dev-router}/**/*.{ts,mts}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@/*"],
          message: "src/ 只放站点代码；Worker 与 shared 用到的模块放进 shared 或所属 Worker。",
        }],
      }],
    },
  },
  {
    // 上报校验不能进入状态核心运行依赖，否则会绕过 Workers Builds 的监视路径隔离。
    files: ["workers/core/src/**/*.ts"],
    ignores: ["workers/core/src/**/*.test.ts", "workers/core/src/preview-entry.ts"],
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
          group: ["@core/*", "**/core/src/**", "@shared/storage", "@shared/state-core"],
          message: "AI 只能通过 PublicStatus 读取公开模型，不能导入状态核心或存储实现。",
        }, {
          group: ["@/*"],
          message: "src/ 只放站点代码；Worker 与 shared 用到的模块放进 shared 或所属 Worker。",
        }],
      }],
    },
  },
  globalIgnores([
    ".react-router/**",
    "**/.wrangler/**",
    "build/**",
    "worker-configuration.d.ts",
    "public/site-assets/**",
    "reporters/**",
    ".claude/**",
    "docs/explainer/**",
    "public/explainer/**",
  ]),
]);

export default eslintConfig;

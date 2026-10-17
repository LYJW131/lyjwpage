import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import babel from "@rolldown/plugin-babel";
import { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

import { chatCodeVersion } from "./scripts/chat-code-version.ts";
import { modelIcons } from "./scripts/model-icons.ts";

const BUILD_TIME = process.env.BUILD_TIME || new Date().toISOString();

// Cloudflare 插件给 workerd 环境带上 `browser` 解析条件，esm-env 因此在 SSR 里把 BROWSER 判为 true，
// NumberFlow 就输出空壳，数字要等水合后才出现。服务端环境改指 false.js。
function esmEnvServerNotBrowser(): Plugin {
  return {
    name: "esm-env-server-not-browser",
    enforce: "pre",
    applyToEnvironment: (environment) => environment.config.consumer === "server",
    async resolveId(source, importer, options) {
      if (source !== "esm-env/browser") return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) return null;
      return { ...resolved, id: path.join(path.dirname(resolved.id), "false.js") };
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), "");
  const env = { ...fileEnv, ...process.env };
  const defineEnv = (name: string) => JSON.stringify(env[name] ?? "");

  let commitSha = env.COMMIT_SHA || env.WORKERS_CI_COMMIT_SHA || "";
  if (!commitSha) {
    try {
      commitSha = execSync("git rev-parse HEAD", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      commitSha = "";
    }
  }

  const backendUrl =
    env.PREVIEW_BACKEND_URL || env.PUBLIC_BACKEND_URL || "https://lyjw.me";

  return {
    plugins: [
      cloudflare({
        viteEnvironment: { name: "ssr" },
        configPath: command === "serve" ? "wrangler.local.jsonc" : "wrangler.jsonc",
      }),
      esmEnvServerNotBrowser(),
      modelIcons(),
      reactRouter(),
      babel({ presets: [reactCompilerPreset()] }),
    ],
    // 只给 Worker 出 source map，wrangler 按 upload_source_maps 上传后换算线上调用栈；浏览器包的 map 会随静态资源公开，所以不出。
    environments: { ssr: { build: { sourcemap: true } } },
    define: {
      "process.env.PUBLIC_BACKEND_URL": JSON.stringify(backendUrl),
      "process.env.PUBLIC_SIGNED_IMAGE_OPTIMIZATION": defineEnv("PUBLIC_SIGNED_IMAGE_OPTIMIZATION"),
      "process.env.PUBLIC_ERROR_REPORT_DEV": defineEnv("PUBLIC_ERROR_REPORT_DEV"),
      "process.env.PUBLIC_CF_WEB_ANALYTICS_TOKENS": defineEnv("PUBLIC_CF_WEB_ANALYTICS_TOKENS"),
      "process.env.BUILD_TIME": JSON.stringify(BUILD_TIME),
      "process.env.COMMIT_SHA": JSON.stringify(commitSha),
      "process.env.COMMIT_MESSAGE": defineEnv("COMMIT_MESSAGE"),
      "process.env.CHAT_CODE_VERSION": JSON.stringify(
        env.CHAT_CODE_VERSION || chatCodeVersion(process.cwd()),
      ),
      "process.env.DEPLOY_ENV": JSON.stringify(
        env.DEPLOY_ENV ??
          (env.WORKERS_CI_BRANCH
            ? env.WORKERS_CI_BRANCH === "main"
              ? "production"
              : "preview"
            : "development"),
      ),
      "process.env.FOOTER_EXTRA_TEXT": defineEnv("FOOTER_EXTRA_TEXT"),
      "process.env.FOOTER_EXTRA_HREF": defineEnv("FOOTER_EXTRA_HREF"),
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
      },
    },
    server: {
      port: 3211,
    },
  };
});

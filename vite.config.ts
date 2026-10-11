import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig, loadEnv } from "vite";

import { chatCodeVersion } from "./scripts/chat-code-version.mjs";

const BUILD_TIME = process.env.BUILD_TIME || new Date().toISOString();

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
    env.PREVIEW_BACKEND_URL || env.PUBLIC_BACKEND_URL || "https://api.homepage.lyjw.llc";

  return {
    plugins: [
      cloudflare({
        viteEnvironment: { name: "ssr" },
        configPath: command === "serve" ? "wrangler.local.jsonc" : "wrangler.jsonc",
      }),
      reactRouter(),
      ...(env.SENTRY_AUTH_TOKEN
        ? [
            sentryVitePlugin({
              org: "yangjunwei-liang",
              project: "lyjwpage",
              authToken: env.SENTRY_AUTH_TOKEN,
              release: { name: commitSha || undefined },
              telemetry: false,
              silent: !env.CI,
              sourcemaps: { filesToDeleteAfterUpload: ["./build/**/*.map"] },
            }),
          ]
        : []),
    ],
    build: { sourcemap: env.SENTRY_AUTH_TOKEN ? "hidden" : false },
    define: {
      "process.env.PUBLIC_BACKEND_URL": JSON.stringify(backendUrl),
      "process.env.PUBLIC_TURNSTILE_SITE_KEY": defineEnv("PUBLIC_TURNSTILE_SITE_KEY"),
      "process.env.PUBLIC_SIGNED_IMAGE_OPTIMIZATION": defineEnv("PUBLIC_SIGNED_IMAGE_OPTIMIZATION"),
      "process.env.PUBLIC_SENTRY_DEV": defineEnv("PUBLIC_SENTRY_DEV"),
      "process.env.PUBLIC_CF_WEB_ANALYTICS_TOKENS": defineEnv("PUBLIC_CF_WEB_ANALYTICS_TOKENS"),
      "process.env.BUILD_TIME": JSON.stringify(BUILD_TIME),
      "process.env.COMMIT_SHA": JSON.stringify(commitSha),
      "process.env.COMMIT_MESSAGE": defineEnv("COMMIT_MESSAGE"),
      "process.env.CHAT_CODE_VERSION": JSON.stringify(
        env.CHAT_CODE_VERSION || chatCodeVersion(process.cwd()),
      ),
      "process.env.SENTRY_ENVIRONMENT": JSON.stringify(
        env.SENTRY_ENVIRONMENT ??
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

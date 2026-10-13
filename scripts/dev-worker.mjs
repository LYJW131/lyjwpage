import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const AI_CONFIGS = ["workers/api/wrangler.test.toml", "workers/ai/wrangler.test.toml"];
const OFFLINE_NAME = "wrangler.test.offline.toml";
const AI_SECTION = /^\[ai\]\n(?:[^[\n].*\n)*/m;

export function withoutAiBinding(toml) {
  return toml.replace(AI_SECTION, "");
}

function wranglerAuthFiles(env, home) {
  const xdg = env.XDG_CONFIG_HOME || path.join(home, ".config");
  return [
    path.join(home, "Library", "Preferences", ".wrangler", "config", "default.toml"),
    path.join(xdg, ".wrangler", "config", "default.toml"),
    path.join(home, ".wrangler", "config", "default.toml"),
  ];
}

export function remoteAiEnabled(env = process.env, home = os.homedir(), exists = fs.existsSync) {
  if (env.DEV_WORKER_AI === "remote") return true;
  if (env.DEV_WORKER_AI === "off") return false;
  if (env.CLOUDFLARE_API_TOKEN) return true;
  return wranglerAuthFiles(env, home).some((file) => exists(file));
}

// AI 绑定只能远程跑，wrangler 没有凭据时整个 dev 会话起不来；去掉它后 api 不评分、ai 路由走兜底档位，其余照常。
function configPaths(remoteAi) {
  return AI_CONFIGS.map((relative) => {
    if (remoteAi) return relative;
    const source = path.join(ROOT, relative);
    const offline = path.join(path.dirname(source), OFFLINE_NAME);
    fs.writeFileSync(offline, withoutAiBinding(fs.readFileSync(source, "utf8")));
    return path.relative(ROOT, offline);
  });
}

function main(extraArgs) {
  const remoteAi = remoteAiEnabled();
  if (!remoteAi) {
    console.warn("[dev:worker] 没有 Cloudflare 凭据，AI 绑定已去掉：本地不跑 Clef。要用就设 CLOUDFLARE_API_TOKEN 或 wrangler login。");
  }
  const [api, ai] = configPaths(remoteAi);
  const fromApi = (relative) => path.relative(path.join(ROOT, "workers/api"), path.join(ROOT, relative));
  const args = [
    "--dir", "workers/api", "exec", "wrangler", "dev",
    "-c", "../dev-router/wrangler.toml",
    "-c", fromApi(api),
    "-c", fromApi(ai),
    "-c", "../ingress/wrangler.test.toml",
    "-c", "../collector/wrangler.test.toml",
    "--port", process.env.DEV_WORKER_PORT || "8788",
    "--persist-to", process.env.DEV_WORKER_STATE || ".wrangler/dev-state",
    ...extraArgs,
  ];
  const child = spawn("pnpm", args, { cwd: ROOT, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));

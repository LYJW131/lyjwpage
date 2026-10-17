import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

import type { GodChatEvent } from "@shared/god-chat";
import { STATUS_VIEWS } from "@shared/status-views";
import type { Env } from "../src/runtime.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== "cloudflare:workers") return nextResolve(specifier, context);
    return { url: "data:text/javascript,export class DurableObject{}", shortCircuit: true };
  },
});
const { handleChat } = await import("../src/chat/handler.ts");
const { issuePass } = await import("../src/chat/pass.ts");

const USAGE = `用法：pnpm --dir workers/ai chat:probe [--tier flash] [--runs 5] [--fixture listening-now-elsewhere-estimated] "问题"
用真实模型跑首页对话（跳过 Clef 与验人），状态视图读 workers/core/dev-fixtures/ 里同名端点的夹具，没有夹具的视图回 404。
--tier 取 Clef 的选项或档位名（flash、think、fable、design）。
ANTHROPIC_API_KEY、DEEPSEEK_API_KEY、EXA_API_KEY、WEB_SEARCH_PROVIDER 取环境变量或 workers/ai/.dev.vars。`;

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args.splice(index, 2)[1] ?? fallback : fallback;
};
const tier = flag("tier", "flash");
const runs = Number(flag("runs", "1"));
const fixtures = flag("fixture", "listening-now-elsewhere-estimated").split(",");
const question = args.join(" ").trim();
if (!question || !Number.isSafeInteger(runs) || runs < 1) {
  console.error(USAGE);
  process.exit(1);
}

const devVars = (() => { try { return readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"); } catch { return ""; } })();
const secret = (name: string) => process.env[name] || devVars.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim() || undefined;
const apiKey = secret("ANTHROPIC_API_KEY");
const deepseekKey = secret("DEEPSEEK_API_KEY");
if (!apiKey || !deepseekKey) {
  console.error("缺 ANTHROPIC_API_KEY 或 DEEPSEEK_API_KEY（环境变量或 workers/ai/.dev.vars）");
  process.exit(1);
}

const NOW_TOKEN = /^\$now([+-]\d+)?$/;
const stamp = (value: unknown, now: number): unknown => {
  if (typeof value === "string") {
    const match = NOW_TOKEN.exec(value);
    return match ? now + Number(match[1] ?? 0) : value;
  }
  if (Array.isArray(value)) return value.map((child) => stamp(child, now));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, stamp(child, now)]));
  return value;
};
const fixtureByPath = new Map(fixtures.map((name) => {
  const slug = (path: string) => path.replace(/^\/api\/status\//, "").replaceAll("/", "-");
  const view = Object.values(STATUS_VIEWS).filter((entry) => name.startsWith(slug(entry.path))).sort((a, b) => b.path.length - a.path.length)[0];
  if (!view) throw new Error(`夹具 ${name} 对不上任何状态视图`);
  return [view.path, JSON.parse(readFileSync(new URL(`../../core/dev-fixtures/${name}.json`, import.meta.url), "utf8"))] as const;
}));

// 和生产一样直连 api.anthropic.com：SDK 会读 ANTHROPIC_BASE_URL，本机若设了它就会绕到别处。
delete process.env.ANTHROPIC_BASE_URL;

const quota = {
  admitVisitor: async () => "ok",
  admitTier: async (_ip: string, wanted: string) => wanted,
};
const env = {
  AI_DEV: "true",
  CHAT_FORCE_TIER: tier,
  CHAT_RATE_LIMIT: "off",
  ANTHROPIC_API_KEY: apiKey,
  DEEPSEEK_API_KEY: deepseekKey,
  TURNSTILE_SECRET_KEY: "probe",
  EXA_API_KEY: secret("EXA_API_KEY"),
  WEB_SEARCH_PROVIDER: secret("WEB_SEARCH_PROVIDER"),
  CHAT_HISTORY_SECRET: "probe",
  ALLOWED_ORIGINS: "https://lyjw.me",
  PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
  CHAT_QUOTA: { idFromName: () => ({}), get: () => quota, getByName: () => quota },
} as unknown as Env;

const { pass } = await issuePass("probe");
for (let run = 1; run <= runs; run++) {
  const response = await handleChat(new Request("https://probe.local/api/chat", {
    method: "POST",
    headers: { "CF-Connecting-IP": "127.0.0.1" },
    body: JSON.stringify({ humanPass: pass, messages: [{ role: "user", content: question }] }),
  }), env, {
    readStatus: async (path) => fixtureByPath.has(path) ? Response.json(stamp(fixtureByPath.get(path), Date.now())) : Response.json({ ok: false, error: "no fixture" }, { status: 404 }),
    readDoc: async () => new Response("no doc", { status: 404 }),
  });
  if (!response.ok) {
    console.log(`#${run} HTTP ${response.status} ${await response.text()}`);
    continue;
  }
  const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as GodChatEvent);
  const text = events.filter((event) => event.type === "text").map((event) => event.text).join("").trim();
  const tools = events.flatMap((event) => event.type === "card" ? [`card:${event.card}`]
    : event.type === "tool" ? event.views.map((view) => `view:${view}`)
    : event.type === "search" ? [`search:${event.query}`]
    : event.type === "doc" ? [`doc:${event.path}`]
    : event.type === "sources" ? event.sources.map((source) => `source:${source.url}`)
    : []);
  console.log(`#${run} [${tools.join(" ") || "no tools"}]\n${text}\n`);
}

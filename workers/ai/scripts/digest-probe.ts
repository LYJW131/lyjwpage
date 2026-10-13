import { readFileSync } from "node:fs";

import Anthropic from "@anthropic-ai/sdk";

import { composeDigest, DIGEST_MODEL } from "../src/digest/compose.ts";
import { digestFacts, readDigestViews } from "../src/digest/facts.ts";

const USAGE = `用法：pnpm --dir workers/ai digest:probe [--models claude-sonnet-5-5,claude-haiku-5-5] [--runs 3] [--origin https://lyjw.me]
读站点的公开状态视图，打印事实清单，再用真实模型逐个写几版摘要，附词数与 token 用量。
ANTHROPIC_API_KEY 取环境变量或 workers/ai/.dev.vars；没有 key 时只打印事实清单。`;

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args.splice(index, 2)[1] ?? fallback : fallback;
};
const models = flag("models", DIGEST_MODEL).split(",").map((model) => model.trim()).filter(Boolean);
const runs = Number(flag("runs", "1"));
const origin = flag("origin", "https://lyjw.me").replace(/\/+$/, "");
if (args.length || !models.length || !Number.isSafeInteger(runs) || runs < 1) {
  console.error(USAGE);
  process.exit(1);
}

const devVars = (() => { try { return readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"); } catch { return ""; } })();
const apiKey = process.env.ANTHROPIC_API_KEY || devVars.match(/^ANTHROPIC_API_KEY=(.+)$/m)?.[1]?.trim();

const views = new Map<string, Response>();
const readStatus = async (path: string) => {
  if (!views.has(path)) views.set(path, await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(20_000) }));
  return views.get(path)!.clone();
};

const now = Date.now();
console.log(`${digestFacts(await readDigestViews(readStatus), now)}\n`);
if (!apiKey) {
  console.error("缺 ANTHROPIC_API_KEY（环境变量或 workers/ai/.dev.vars），只打印事实清单");
  process.exit(0);
}

// 和生产一样直连 api.anthropic.com：SDK 会读 ANTHROPIC_BASE_URL，本机若设了它就会绕到别处。
delete process.env.ANTHROPIC_BASE_URL;
const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 });

for (const model of models) {
  for (let run = 1; run <= runs; run++) {
    let usage: Anthropic.Usage | null = null;
    const started = Date.now();
    try {
      const outcome = await composeDigest({
        readStatus,
        createMessage: async (params) => {
          const message = await client.messages.create(params);
          usage = message.usage;
          return message;
        },
        previousInputHash: null,
        now,
        model,
      });
      if (outcome.status !== "composed") throw new Error(`unexpected outcome ${outcome.status}`);
      const tokens = usage as Anthropic.Usage | null;
      const words = outcome.digest.text.split(/\s+/).filter(Boolean).length;
      console.log(`── ${model} #${run} · ${words} words · ${outcome.digest.text.length} chars · in ${tokens?.input_tokens ?? "?"} / out ${tokens?.output_tokens ?? "?"} tokens · ${((Date.now() - started) / 1000).toFixed(1)} s`);
      console.log(`${outcome.digest.text}\n`);
    } catch (error) {
      console.log(`── ${model} #${run} failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
}

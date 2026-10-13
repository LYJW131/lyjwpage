import { readFileSync } from "node:fs";

import { composeDigest, DIGEST_PICKER_MODEL, taglineCandidates, type PickTagline } from "../src/digest/compose.ts";
import { digestMessage, digestSignals, readDigestViews } from "../src/digest/facts.ts";
import { digestScene } from "../src/digest/situation.ts";

const USAGE = `用法：pnpm --dir workers/ai digest:probe [--runs 3] [--origin https://lyjw.me] [--previous 代码不眠]
读站点的公开状态视图，打印事实清单、规则判出的情境、挑出的格子和这一轮的候选标语，再让 Clef 挑几次。
Clef 走 Workers AI REST：CLOUDFLARE_ACCOUNT_ID 与 CLOUDFLARE_API_TOKEN 取环境变量或根目录 .env.local；缺了只打印规则兜底的结果。`;

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args.splice(index, 2)[1] ?? fallback : fallback;
};
const runs = Number(flag("runs", "1"));
const origin = flag("origin", "https://lyjw.me").replace(/\/+$/, "");
const previousHeadline = flag("previous", "") || null;
if (args.length || !Number.isSafeInteger(runs) || runs < 1) {
  console.error(USAGE);
  process.exit(1);
}

const local = (() => { try { return readFileSync(new URL("../../../.env.local", import.meta.url), "utf8"); } catch { return ""; } })();
const env = (name: string) => process.env[name] || local.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim();
const account = env("CLOUDFLARE_ACCOUNT_ID");
const token = env("CLOUDFLARE_API_TOKEN");

const views = new Map<string, Response>();
const readStatus = async (path: string) => {
  if (!views.has(path)) views.set(path, await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(20_000) }));
  return views.get(path)!.clone();
};

const now = Date.now();
const read = await readDigestViews(readStatus);
const { content, options } = digestMessage(read, now);
const signals = digestSignals(read, now);
const scene = digestScene(options, signals);
console.log(`${content}\n`);
if (scene.quiet) {
  console.log("情境：quiet（卡片显示时钟）");
  process.exit(0);
}
console.log(`情境：${scene.primary}${scene.accents.length ? `，附带 ${scene.accents.join("、")}` : ""}`);
console.log(`格子：${scene.highlights.map(({ topic, value, unit, atLeast, caption }) => `[${topic}] ${value}${atLeast ? "+" : ""} ${unit} · ${caption}`).join("  ")}`);
console.log(`候选（${signals.date}）：${taglineCandidates(scene.primary, scene.accents, signals.date).join(" ")}\n`);

const pick: PickTagline | undefined = account && token
  ? async (input) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${DIGEST_PICKER_MODEL}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "clef", ...input }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
    const { result } = (await response.json()) as { result: { answers: { tagline: { probabilities: Record<string, number> } } } };
    console.log(`  Clef 概率 ${JSON.stringify(result.answers.tagline.probabilities)}`);
    return result;
  }
  : undefined;
if (!pick) console.error("缺 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN，按规则取第一条候选");

for (let run = 1; run <= runs; run++) {
  const outcome = await composeDigest({ readStatus, pick, previousInputHash: null, previousHeadline, now });
  if (outcome.status !== "composed") throw new Error(`unexpected outcome ${outcome.status}`);
  console.log(`── #${run} ${outcome.digest.model}：${outcome.digest.headline}\n`);
}

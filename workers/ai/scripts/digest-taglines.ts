import { readFileSync, writeFileSync } from "node:fs";

import Anthropic from "@anthropic-ai/sdk";

import { DIGEST_SITUATIONS, type DigestSituation } from "../src/digest/situation.ts";
import { DIGEST_TAGLINES } from "../src/digest/taglines.ts";
import { isTagline } from "../src/digest/compose.ts";

const USAGE = `用法：pnpm --dir workers/ai digest:taglines [--situations agentsAllDay,music] [--count 30] [--model claude-opus-5-5]
按 src/digest/situation.ts#DIGEST_SITUATIONS 逐个情境让模型写中文标语，补齐到每个情境 --count 条，写回 src/digest/taglines.ts。
已有的行原样保留（人工删掉的行下次可能被重新写出来，删完记得看 diff）；不合格式和跨情境重复的行丢掉。
ANTHROPIC_API_KEY 取环境变量或 workers/ai/.dev.vars。`;

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args.splice(index, 2)[1] ?? fallback : fallback;
};
const all = Object.keys(DIGEST_SITUATIONS) as DigestSituation[];
const only = flag("situations", all.join(",")).split(",").map((key) => key.trim()).filter(Boolean);
const count = Number(flag("count", "30"));
const model = flag("model", "claude-opus-5-5");
if (args.length || !Number.isSafeInteger(count) || count < 1 || only.some((key) => !all.includes(key as DigestSituation))) {
  console.error(USAGE);
  process.exit(1);
}

const devVars = (() => { try { return readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"); } catch { return ""; } })();
const apiKey = process.env.ANTHROPIC_API_KEY || devVars.match(/^ANTHROPIC_API_KEY=(.+)$/m)?.[1]?.trim();
if (!apiKey) {
  console.error("缺 ANTHROPIC_API_KEY（环境变量或 workers/ai/.dev.vars）");
  process.exit(1);
}
delete process.env.ANTHROPIC_BASE_URL;
const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });

const library: Record<DigestSituation, string[]> = Object.fromEntries(all.map((key) => [key, [...(DIGEST_TAGLINES[key] ?? [])]])) as Record<DigestSituation, string[]>;
const taken = () => new Set(Object.values(library).flat());

const SYSTEM = `You write taglines for the summary card at the top of LYJW's personal homepage (lyjw.me). The card sums up the past 24 hours of LYJW's live data (coding with AI agents, music, shows, games, fitness, work on the homepage itself) in one big headline. The site stores many taglines per situation; code picks the situation and a small model picks one line.

Each tagline:
- 3 to 5 Simplified Chinese characters, Han characters only: no punctuation, spaces, Latin letters or digits.
- In the voice of an Apple China tagline: short, confident, concrete, with a light, dry touch (e.g. 强得很, 就是快, 大有可为, 超能打, 好看又能打, 一个顶俩).
- True for any day that fits the situation: no names of songs, artists, shows, games, apps or people, no numbers, and no guesses about reasons, moods or plans. Don't name LYJW.
- Never mocks, never sounds like an ad for a product.
Vary the wording and structure across the lines; don't repeat the same pattern with one word swapped.`;

const SCHEMA = { type: "object", properties: { lines: { type: "array", items: { type: "string" } } }, required: ["lines"], additionalProperties: false };

for (const key of only as DigestSituation[]) {
  const missing = count - library[key].length;
  if (missing <= 0) continue;
  const message = await client.messages.create({
    model,
    max_tokens: 4_096,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{
      role: "user",
      content: `Situation: ${DIGEST_SITUATIONS[key]}\n\nWrite ${Math.ceil(missing * 1.5)} new taglines for this situation.${taken().size ? `\nThese already exist, don't repeat them: ${[...taken()].join("、")}` : ""}`,
    }],
  });
  const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  const lines = (JSON.parse(text) as { lines: unknown[] }).lines.filter((line): line is string => typeof line === "string").map((line) => line.trim());
  const fresh = [...new Set(lines.filter(isTagline))].filter((line) => !taken().has(line)).slice(0, missing);
  library[key].push(...fresh);
  console.log(`${key}: +${fresh.length}（共 ${library[key].length}）${fresh.join(" ")}`);
}

const body = all.map((key) => `  ${key}: [\n${library[key].map((line) => `    "${line}",`).join("\n")}\n  ],`).join("\n");
writeFileSync(
  new URL("../src/digest/taglines.ts", import.meta.url),
  `import type { DigestSituation } from "./situation";\n\n// 由 scripts/digest-taglines.ts 生成后人工删改：可以直接删行或手写新行，重跑脚本只补齐条数、不动已有的行。\nexport const DIGEST_TAGLINES: Record<DigestSituation, readonly string[]> = {\n${body}\n};\n`,
);

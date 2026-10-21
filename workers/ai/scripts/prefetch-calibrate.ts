import { readFileSync, writeFileSync } from "node:fs";

import { PREFETCH_MIN_PROBABILITY, routerInput } from "../src/chat/router.ts";

const USAGE = `用法：
  pnpm --dir workers/ai prefetch:calibrate run <模型> <输出.json>   用 scripts/prefetch-cases.json 的每条问题调一次模型，存下状态题与文档题的选项和概率
  pnpm --dir workers/ai prefetch:calibrate score <结果.json> ...    按标注算每题的准确率、校准与阈值（src/chat/router.ts#PREFETCH_MIN_PROBABILITY）
模型写 clef（Workers AI REST，CLOUDFLARE_ACCOUNT_ID 与 CLOUDFLARE_API_TOKEN 取环境变量或根目录 .env.local）或 jev-<版本>（TypeSafe System One，TYPESAFE_API_KEY，云端出口代理会自动带上）。`;

type Question = keyof typeof PREFETCH_MIN_PROBABILITY;
const QUESTIONS = Object.keys(PREFETCH_MIN_PROBABILITY) as Question[];
type Case = { q: string } & Record<Question, string[]>;
type Answer = { choice?: string; probabilities?: Record<string, number> };
type Row = { q: string; ms: number; usage?: { input_tokens?: number; output_tokens?: number }; error?: string } & Partial<Record<Question, Answer>>;

const cases = JSON.parse(readFileSync(new URL("./prefetch-cases.json", import.meta.url), "utf8")) as Case[];
const local = (() => { try { return readFileSync(new URL("../../../.env.local", import.meta.url), "utf8"); } catch { return ""; } })();
const env = (name: string) => process.env[name] || local.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim();

async function ask(model: string, q: string): Promise<{ answers: Record<string, Answer>; usage?: Row["usage"] }> {
  const body = routerInput([{ role: "user", content: q }]);
  const clef = model === "clef";
  const url = clef
    ? `https://api.cloudflare.com/client/v4/accounts/${env("CLOUDFLARE_ACCOUNT_ID")}/ai/run/@cf/cloudflare/clef`
    : "https://api.typesafe.ai/v1/systemone";
  const token = clef ? env("CLOUDFLARE_API_TOKEN") : env("TYPESAFE_API_KEY");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify({ ...body, model: clef ? body.model : model }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
  const json = (await response.json()) as { result?: { answers: Record<string, Answer>; usage?: Row["usage"] }; answers?: Record<string, Answer>; usage?: Row["usage"] };
  const result = json.result ?? json;
  return { answers: result.answers ?? {}, usage: result.usage };
}

async function run(model: string, out: string) {
  const rows: Row[] = [];
  const queue = [...cases];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const started = Date.now();
      try {
        const { answers, usage } = await ask(model, next.q);
        rows.push({ q: next.q, ms: Date.now() - started, usage, ...Object.fromEntries(QUESTIONS.map((key) => [key, answers[key]])) });
      } catch (error) {
        rows.push({ q: next.q, ms: Date.now() - started, error: String(error) });
      }
    }
  }));
  writeFileSync(out, JSON.stringify({ model, rows }, null, 1));
  console.log(`${model}: ${rows.length} 条，${rows.filter((row) => row.error).length} 条出错 → ${out}`);
}

// 预取当且仅当选中项不是 none 且概率不低于阈值；选中项在标注的可接受集合里算预取对了。
// 召回的分母是标注里需要预取的题数，所以选错或选 none 的漏预取也算进去。
type Item = { p: number; prefetchable: boolean; correct: boolean; needed: boolean };

function items(rows: Row[], question: Question): Item[] {
  const labels = new Map(cases.map((entry) => [entry.q, entry[question]]));
  return rows.flatMap((row) => {
    const answer = row[question];
    const label = labels.get(row.q);
    if (!answer?.choice || !label) return [];
    const p = answer.probabilities?.[answer.choice] ?? 0;
    return [{ p, prefetchable: answer.choice !== "none", correct: label.includes(answer.choice), needed: !label.includes("none") }];
  });
}

function prf(list: Item[], threshold: number) {
  const fire = list.filter((item) => item.prefetchable && item.p >= threshold);
  const tp = fire.filter((item) => item.correct).length;
  const needed = list.filter((item) => item.needed).length;
  const precision = fire.length ? tp / fire.length : 1;
  const recall = needed ? tp / needed : 1;
  return { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0, fired: fire.length };
}

const GRID = Array.from({ length: 96 }, (_, index) => 0.05 + index * 0.01);
const MIN_PRECISION = 0.8;

function bestThreshold(list: Item[]): number {
  let best = { threshold: 1, f1: -1 };
  for (const threshold of GRID) {
    const { precision, f1 } = prf(list, threshold);
    if (precision >= MIN_PRECISION && f1 > best.f1) best = { threshold, f1 };
  }
  return best.threshold;
}

// 分层五折：阈值只在训练折上选，验证折上算，避免在同一批题上调完又自评。
function crossValidated(list: Item[]) {
  const folds: Item[][] = [[], [], [], [], []];
  [list.filter((item) => item.needed), list.filter((item) => !item.needed)].forEach((group) => group.forEach((item, index) => folds[index % 5].push(item)));
  let tp = 0, fired = 0, needed = 0;
  const thresholds: number[] = [];
  folds.forEach((fold, index) => {
    const threshold = bestThreshold(folds.filter((_, other) => other !== index).flat());
    thresholds.push(threshold);
    const fire = fold.filter((item) => item.prefetchable && item.p >= threshold);
    fired += fire.length;
    tp += fire.filter((item) => item.correct).length;
    needed += fold.filter((item) => item.needed).length;
  });
  const precision = fired ? tp / fired : 1, recall = needed ? tp / needed : 1;
  return { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0, thresholds };
}

// 选中项概率当作「选对了」的置信度看：Brier 越低越好，分箱看平均概率与实际对的比例差多少。
function calibration(list: Item[]) {
  const brier = list.reduce((sum, item) => sum + (item.p - Number(item.correct)) ** 2, 0) / list.length;
  const sorted = [...list].sort((a, b) => a.p - b.p);
  const size = Math.ceil(sorted.length / 5);
  const bins = Array.from({ length: Math.ceil(sorted.length / size) }, (_, index) => sorted.slice(index * size, (index + 1) * size)).map((bin) => ({
    meanP: bin.reduce((sum, item) => sum + item.p, 0) / bin.length,
    accuracy: bin.filter((item) => item.correct).length / bin.length,
    n: bin.length,
  }));
  return { brier, bins };
}

function score(files: string[]) {
  const pct = (value: number) => `${(value * 100).toFixed(0)}%`;
  for (const file of files) {
    const { model, rows } = JSON.parse(readFileSync(file, "utf8")) as { model: string; rows: Row[] };
    const ok = rows.filter((row) => !row.error);
    const tokens = ok.reduce((sum, row) => sum + (row.usage?.input_tokens ?? 0), 0);
    const ms = ok.map((row) => row.ms).sort((a, b) => a - b);
    console.log(`\n## ${model}（${ok.length}/${rows.length} 条成功，输入 token 共 ${tokens || "未知"}，耗时中位 ${ms[Math.floor(ms.length / 2)]}ms）`);
    for (const question of QUESTIONS) {
      const list = items(ok, question);
      const current = prf(list, PREFETCH_MIN_PROBABILITY[question]);
      const tuned = bestThreshold(list);
      const best = prf(list, tuned);
      const cv = crossValidated(list);
      const cal = calibration(list);
      console.log(`### ${question}：首选准确率 ${pct(list.filter((item) => item.correct).length / list.length)}（${list.length} 题）`);
      console.log(`- 现阈值 ${PREFETCH_MIN_PROBABILITY[question]}：精确 ${pct(current.precision)} 召回 ${pct(current.recall)} F1 ${current.f1.toFixed(2)}，预取 ${current.fired} 次`);
      console.log(`- 全集最优 ${tuned.toFixed(2)}（精确 ≥ ${pct(MIN_PRECISION)}）：精确 ${pct(best.precision)} 召回 ${pct(best.recall)} F1 ${best.f1.toFixed(2)}`);
      console.log(`- 五折验证：精确 ${pct(cv.precision)} 召回 ${pct(cv.recall)} F1 ${cv.f1.toFixed(2)}，各折阈值 ${cv.thresholds.map((value) => value.toFixed(2)).join(" ")}`);
      console.log(`- 校准：Brier ${cal.brier.toFixed(3)}；分箱（平均概率→实际对的比例）${cal.bins.map((bin) => `${bin.meanP.toFixed(2)}→${pct(bin.accuracy)}`).join("，")}`);
    }
  }
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === "run" && rest.length === 2) await run(rest[0], rest[1]);
else if (mode === "score" && rest.length) score(rest);
else {
  console.log(USAGE);
  process.exit(mode === "--help" ? 0 : 1);
}

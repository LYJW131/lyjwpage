// 把 analyze.mjs 的 JSON 压成人能读的摘要：node summarize.mjs <analysis.json> [from] [to]
import fs from "node:fs";
const [p, fromArg, toArg] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(p, "utf8"));
const from = +(fromArg || 0), to = toArg ? +toArg : 1e9;
const geo = d.geo.filter((g) => g.t >= from && g.t <= to);
const groups = new Map();
for (const g of geo) {
  const k = g.type + " | " + g.key;
  if (!groups.has(k)) groups.set(k, { n: 0, t0: g.t, t1: g.t, ex: g });
  const e = groups.get(k); e.n++; e.t1 = g.t;
}
console.log("WARN:", d.meta.warn.length ? "\n  " + d.meta.warn.join("\n  ") : "none");
console.log("logs:", d.logs.length ? d.logs.slice(0, 20) : "none");
console.log(`geo issue groups (${groups.size}):`);
for (const [k, e] of [...groups].sort((a, b) => a[1].t0 - b[1].t0)) {
  const { t, type, key, ...rest } = e.ex;
  console.log(`  ${e.t0.toFixed(2)}–${e.t1.toFixed(2)}s ×${e.n}  ${k}  ${JSON.stringify(rest).slice(0, 160)}`);
}
const pops = d.pops.filter((q) => q.t >= from && q.t <= to && !q.wipe);
console.log(`pops (${pops.length}, 转场附近的已略去):`);
for (const q of pops.slice(0, 80)) console.log("  " + JSON.stringify(q).slice(0, 200));

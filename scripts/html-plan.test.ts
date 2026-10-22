import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { lintPlan, renderPlan, type Plan, type Repo } from "./html-plan.ts";

const repo: Repo = {
  exists: (file) => file === "src/lib/a.ts",
  read: () => "export function realThing() {}",
};

function plan(): Plan {
  return {
    id: "demo",
    title: "示例",
    summary: "改一处卡片。",
    claims: [
      {
        id: "see",
        text: "卡片多一行时间。",
        exhibit: { kind: "mock", html: "<p>卡片</p>" },
        children: [
          {
            id: "how",
            text: "时间从状态端点带出来。",
            exhibit: { kind: "calls", text: "a()\n└─ b()" },
            children: [{ id: "where", text: "改这一个函数。", exhibit: { kind: "code", file: "src/lib/a.ts", symbol: "realThing", text: "realThing()" } }],
          },
        ],
      },
      { id: "copy", text: "文案用英文。", exhibit: { kind: "table", head: ["", ""], rows: [["a", "b"]] } },
    ],
    decisions: [{ id: "d1", under: "see", q: "时间放哪？", default: 0, why: "离标题近。", options: [{ label: "标题下", effect: "放在标题下面。" }, { label: "底部", effect: "放在卡片底部。" }] }],
  };
}

test("合格的计划没有错误", () => {
  assert.deepEqual(lintPlan(plan(), repo).errors, []);
});

test("第三层的文件不存在或符号找不到就报错，标了新建的文件放行", () => {
  const p = plan();
  const where = p.claims[0].children![0].children![0];
  where.exhibit = { kind: "code", file: "src/lib/a.ts", symbol: "madeUp", text: "x" };
  assert.match(lintPlan(p, repo).errors.join("\n"), /找不到 madeUp/);
  where.exhibit = { kind: "files", files: [{ file: "src/lib/ghost.ts", change: "改" }, { file: "src/lib/new.ts", change: "新建" }] };
  const errors = lintPlan(p, repo).errors;
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ghost\.ts 不存在/);
});

test("主张写成长句、多句或列表就报错", () => {
  const p = plan();
  p.claims[1].text = "这".repeat(61) + "。";
  assert.match(lintPlan(p, repo).errors.join("\n"), /超过 60/);
  p.claims[1].text = "一。二。三。";
  assert.match(lintPlan(p, repo).errors.join("\n"), /3 句/);
  p.claims[1].text = "- 一\n- 二";
  assert.match(lintPlan(p, repo).errors.join("\n"), /列表/);
});

test("决定要问句、有默认项、挂在存在的主张下，且不超过上限", () => {
  const p = plan();
  p.decisions[0] = { ...p.decisions[0], q: "时间放哪", default: 5, under: "nope" };
  const errors = lintPlan(p, repo).errors.join("\n");
  assert.match(errors, /问句/);
  assert.match(errors, /default/);
  assert.match(errors, /不存在的主张 nope/);
  p.decisions = Array.from({ length: 6 }, (_, i) => ({ ...plan().decisions[0], id: `d${i}` }));
  assert.match(lintPlan(p, repo).errors.join("\n"), /超过 5/);
});

test("展品要和层级对得上，草图不放脚本", () => {
  const p = plan();
  p.claims[1].exhibit = { kind: "code", text: "x" };
  assert.match(lintPlan(p, repo).errors.join("\n"), /第 1 层不用 code/);
  p.claims[0].exhibit = { kind: "mock", html: "<script>1</script>" };
  assert.match(lintPlan(p, repo).errors.join("\n"), /不放脚本/);
});

test("出页面时计划 JSON 里的结束标签不会逃出脚本元素", () => {
  const p = plan();
  p.title = "a</script><b>";
  const html = renderPlan(p, "<title>{{TITLE}}</title><script type=\"application/json\">{{PLAN}}</script>");
  assert.equal(html.match(/<\/script>/g)?.length, 1);
  assert.match(html, /<title>a&lt;\/script>&lt;b><\/title>/);
});

test("skill 里的示例计划按真仓库查也没有错误", () => {
  const example = JSON.parse(readFileSync(new URL("../.claude/skills/lyjwpage-html-plan/example.plan.json", import.meta.url), "utf8")) as Plan;
  assert.deepEqual(lintPlan(example).errors, []);
});

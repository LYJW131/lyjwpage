import { Canvas, C1, C2, C3, COL, type Lang } from "./canvas.ts";

export function workflow(lang: Lang): Canvas {
  const c = new Canvas(864, 696, lang);

  const lyjw = c.card({ x: C1, y: 24, w: COL, h: 96 }, "lyjw", ["定方向", "Direction"], "lyjw");
  c.lines(lyjw, [[["一句话需求", "One-line asks"], "title"], [["拍板 · 看图 · 说「合」", "decides · reviews · merges"], "cap"]]);
  const cron = c.card({ x: C2, y: 24, w: COL, h: 96 }, ["定时触发", "Schedules"], "Cron", "outside");
  c.lines(cron, [[["云端 routine", "Cloud routines"], "title"], [["从上次的书签接着跑", "resume from a bookmark"], "cap"]]);
  const visitors = c.card({ x: C3, y: 24, w: COL, h: 96 }, ["访客", "Visitors"], "lyjw.me", "outside");
  c.lines(visitors, [[["在首页对话里提改动", "Ask in homepage chat"], "title"], [["授权 GitHub 后开构建", "authorize GitHub to build"], "cap"]]);

  c.region({ x: 12, y: 144, w: 840, h: 336 }, "Claude", "claude");

  const chat = c.card({ x: C1, y: 168, w: COL, h: 96 }, ["项目聊天", "Project chat"], ["协调", "Coordinator"], "claude");
  c.lines(chat, [[["接每句话，分派线程", "Takes every message"], "title"], [["晨报 · 转贴决策卡", "brief · decision cards"], "cap"]]);
  const thread = c.card({ x: C1, y: 312, w: COL, h: 144 }, ["线程", "Thread"], "Claude", "claude");
  c.lines(thread, [[["一件事一个线程", "One thread per task"], "title"], [["一个分支，做到上线", "own branch, through deploy"], "cap"]], 64);
  c.chip({ x: thread.x, y: thread.y + 64, w: thread.w, h: 40 }, ["Haiku 验证员", "Haiku verifier"], null, ["按提交签分级回执", "graded receipt per commit"], "claude");

  const routines = c.card({ x: C2, y: 168, w: COL, h: 168 }, ["定时任务", "Routines"], null, "claude");
  c.rows(routines, [
    [["代码审查", "Code review"], "PR"],
    [["提炼 skill", "Skill mining"], "PR"],
    [["记忆镜像", "Memory mirror"], "PR"],
    [["collector 盯防", "Collector watch"], ["修复草稿", "fix draft"]],
    [["Anthropic 动态", "Anthropic digest"], ["报告", "report"]],
  ], 8);

  const planner = c.card({ x: C3, y: 168, w: COL, h: 96 }, ["设计会话", "Design session"], "Opus", "claude");
  c.lines(planner, [[["只读沙盒里出计划", "Plans in a read-only box"], "title"], ["Managed Agents", "cap"]]);
  const build = c.card({ x: C3, y: 312, w: COL, h: 96 }, ["访客构建", "Visitor build"], "Actions", "claude");
  c.lines(build, [[["先审计划，再实现", "Review plan, then build"], "title"], [["build.yml · 无写凭据", "build.yml · no write token"], "cap"]]);

  const pr = c.card({ x: C1, y: 528, w: COL, h: 120 }, "PR", null, "flow");
  c.lines(pr, [[["分支预览", "Branch preview"], "title"], ["*.preview.lyjw.dev", "cap"], [["UI 在预览上验", "UI checked here"], "cap"]]);
  const gate = c.card({ x: C2, y: 528, w: COL, h: 120 }, ["合并门槛", "Merge gate"], null, "flow");
  c.rows(gate, [
    [["CI 门禁", "CI"], ["lint · 测试 · 检查", "lint · tests · rules"]],
    [["机器评审", "Bot review"], ["大改逻辑才等", "logic changes"]],
    [["lyjw 点头", "lyjw's OK"], ["UI 变化看图", "UI changes"]],
  ], 8);
  const main = c.card({ x: C3, y: 528, w: COL, h: 120 }, "main", "Workers Builds", "flow");
  c.lines(main, [[["合并提交，自动部署", "Merged, auto-deployed"], "title"], [["ESA 首页随之刷新", "ESA home refreshed"], "cap"], [["核对 /api/version", "check /api/version"], "cap"]]);

  c.edge([[144, 120], [144, 168]], { start: true });
  c.edge([[432, 120], [432, 168]]);
  c.edge([[720, 120], [720, 168]]);
  c.edge([[312, 216], [264, 216]]);
  c.edge([[144, 264], [144, 312]]);
  c.note(156, 288, ["开线程", "opens a thread"]);
  c.edge([[720, 264], [720, 312]]);
  c.note(732, 288, ["访客确认计划", "visitor confirms"]);

  c.edge([[144, 456], [144, 528]]);
  c.edge([[432, 336], [432, 504], [144, 504]], { end: false });
  c.edge([[720, 408], [720, 504], [432, 504]], { end: false });
  for (const x of [144, 432]) c.dot(x, 504);
  c.note(576, 504, ["都以 PR 进 main", "everything lands as a PR"], "middle");

  c.edge([[264, 588], [312, 588]]);
  c.edge([[552, 588], [600, 588]]);
  c.note(576, 144, ["共享一份项目记忆", "one shared project memory"], "middle");

  c.legend(C1, 680, [
    ["lyjw", "lyjw"],
    ["claude", "Claude"],
    ["flow", ["GitHub · Cloudflare", "GitHub · Cloudflare"]],
    ["outside", ["外部触发", "Outside triggers"]],
  ], false);
  return c;
}

import { Canvas, C1, C2, C3, COL, type Lang } from "./canvas.ts";

export function architecture(lang: Lang): Canvas {
  const c = new Canvas(864, 864, lang);

  const sources = c.card({ x: C1, y: 24, w: C2 + COL - C1, h: 120 }, ["采集端", "Sources"], ["设备与上报器", "Devices · reporters"], "outside");
  c.tags(sources, ["Mac", "iPhone", "HomePod", "Emby", "PlayStation", "Quest", ["Linux 节点", "Linux node"], ["Coding agent", "Coding agents"]], 4);
  const visitors = c.card({ x: C3, y: 24, w: COL, h: 120 }, ["访客", "Visitors"], null, "outside");
  c.rows(visitors, [["lyjw.me", ["直连", "direct"]], ["lyjw131.com", ["经阿里云 ESA", "via Alibaba ESA"]], ["/mcp", ["MCP 客户端", "MCP clients"]]]);

  c.region({ x: 12, y: 192, w: 840, h: 504 }, "Cloudflare", "worker");

  const ingress = c.card({ x: C1, y: 216, w: COL, h: 96 }, "Ingress", "Worker", "worker");
  c.lines(ingress, [[["验身份 · 校验 · 拆分", "Auth · validate · split"], "title"], [["Access 之后，按来源限权", "behind Access, per source"], "cap"]]);
  const collector = c.card({ x: C1, y: 456, w: COL, h: 96 }, "Collector", "Worker", "worker");
  c.lines(collector, [[["定时拉取外部服务", "Polls outside services"], "title"], [["Apple Music 查询与补全", "Apple Music lookups"], "cap"]]);

  const core = c.card({ x: C2, y: 216, w: COL, h: 168 }, "Core", "Worker", "worker");
  c.lines(core, [[["实时状态的唯一权威", "Owns all live state"], "title"]], 44);
  c.chip({ x: core.x, y: core.y + 40, w: core.w, h: 40 }, "StateHub", "DO", ["快照 · Pulse · 用量账本", "snapshots · Pulse · ledgers"], "do");
  c.chip({ x: core.x, y: core.y + 88, w: core.w, h: 40 }, "LivePushRoom", "DO", ["WebSocket 推送 · 在线人数", "WebSocket push · presence"], "do");
  c.lines(c.card({ x: C2, y: 408, w: COL, h: 72 }, "KV", "Lag", "store"), [[["可滞后快照", "Lag-tolerant snapshots"], "title"]]);
  c.lines(c.card({ x: C2, y: 504, w: COL, h: 72 }, "D1", "History", "store"), [[["长期归档 · 不对外读", "Archive · never served"], "title"]]);
  c.lines(c.card({ x: C2, y: 600, w: COL, h: 72 }, "R2", "Images", "store"), [[["图片 · 上报端直传", "Images · direct uploads"], "title"]]);

  const site = c.card({ x: C3, y: 216, w: COL, h: 120 }, "Site", "Worker", "worker");
  c.lines(site, [["React Router SSR", "title"], [["首屏按卡读状态", "first screen, card by card"], "cap"], [["Workers 缓存 · /img/*", "Workers cache · /img/*"], "cap"]]);
  const ai = c.card({ x: C3, y: 432, w: COL, h: 96 }, "AI", "Worker", "worker");
  c.lines(ai, [[["对话 · MCP · 访客构建", "Chat · MCP · builds"], "title"], [["Clef 选档 · 经 core 读状态", "Clef tiers · reads via core"], "cap"]]);

  const external = c.card({ x: C1, y: 720, w: COL, h: 120 }, ["外部服务", "Outside services"], null, "outside");
  c.rows(external, [["Apple Music", null], ["GitHub · Cloudflare", null], [["PageSpeed · 状态页", "PageSpeed · status pages"], null]]);
  const models = c.card({ x: C3, y: 720, w: COL, h: 120 }, ["模型与 GitHub", "Models · GitHub"], null, "outside");
  c.rows(models, [["Anthropic · DeepSeek", null], ["Exa · Managed Agents", null], ["GitHub App · Actions", null]]);

  c.edge([[144, 144], [144, 216]]);
  c.note(156, 168, "Access token · /api/ingest/*");
  c.edge([[660, 144], [660, 216]], { start: true });
  c.note(672, 168, "HTML · /api · /ws");

  c.edge([[144, 312], [144, 456]], { dash: true });
  c.note(156, 384, ["补全正在听", "enrich now playing"]);
  c.edge([[144, 720], [144, 552]]);
  c.note(156, 636, ["每分钟拉取", "polled every minute"]);

  c.edge([[264, 264], [312, 264]]);
  c.edge([[288, 264], [288, 540], [312, 540]]);
  c.edge([[288, 444], [312, 444]]);
  c.edge([[264, 504], [288, 504]], { end: false });
  for (const y of [264, 444, 504]) c.dot(288, y);

  c.edge([[552, 264], [600, 264]]);
  c.edge([[552, 636], [576, 636], [576, 264]], { end: false });
  c.edge([[552, 444], [576, 444]], { end: false });
  c.edge([[576, 480], [600, 480]]);
  for (const y of [264, 444, 480]) c.dot(576, y);

  c.edge([[660, 336], [660, 432]]);
  c.note(672, 384, ["对话 · /mcp · 构建", "chat · /mcp · builds"]);
  c.edge([[660, 528], [660, 720]], { start: true });
  c.note(672, 624, ["模型 · 搜索 · PR", "models · search · PRs"]);
  c.note(432, 696, ["Worker 之间走 Service Binding", "Workers talk over Service Bindings"], "middle");

  c.legend(C2 + 12, 756, [
    ["worker", "Worker"],
    ["do", "Durable Object"],
    ["store", ["存储", "Storage"]],
    ["outside", ["Cloudflare 之外", "Outside Cloudflare"]],
  ], true);
  return c;
}

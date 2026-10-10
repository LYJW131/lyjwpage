import { site } from "@/lib/site";

import type { SiteTool } from "./registry";

export type ReadDoc = (url: string) => Promise<Response>;

const HUB_REPO = "https://github.com/LYJW131/MacTelemetryHub";

// 白名单只收讲设计的现状文档和各 Worker 的成对修改规则（构建规划要据此列全路径）；文档在运行时从公开仓库的 main 读，改文档不用重发 Worker，新增条目才要改这里。
const PROJECT_DOCS = {
  overview: { path: "README.en.md", note: "Project overview (English): every card, architecture, key design choices, tech stack, where to start reading the source" },
  conventions: { path: "AGENTS.md", note: "Engineering rules: API naming and cross-client contracts, deploy flow, docs and comment conventions" },
  liveStatus: { path: "docs/telemetry-subsystems.md", note: "Each live-status module: how its data is reported, data flow, protocol decisions" },
  storage: { path: "docs/state-storage.md", note: "Worker data backend: Durable Object / KV / D1 storage, public data boundary, first-paint cache and invalidation" },
  workersDeploy: { path: "docs/workers-builds.md", note: "How the Workers deploy through Cloudflare Workers Builds, watch paths, branch previews" },
  facts: { path: "docs/explainer/FACTS.md", note: "Fact sheet behind the site's explainer animation: each endpoint and number with its source" },
  apiRules: { path: "workers/api/AGENTS.md", note: "API Worker invariants and the files that must change together (section 须成对修改)" },
  aiRules: { path: "workers/ai/AGENTS.md", note: "AI Worker invariants and the files that must change together (section 迁移与成对修改)" },
  collectorRules: { path: "workers/collector/AGENTS.md", note: "Collector Worker invariants and the files that must change together (section 须成对修改)" },
  ingressRules: { path: "workers/ingress/AGENTS.md", note: "Ingest Worker invariants and what a new report source must change together (section 新增来源要一起做)" },
  apiWorker: { path: "workers/api/README.md", note: "API Worker (state core): endpoints, StateHub, WebSocket push, cron and public status reads" },
  aiWorker: { path: "workers/ai/README.md", note: "AI Worker: the Talk to God chat, model routing, quotas, site tools and public MCP" },
  visitorBuild: { path: "docs/build-routine.md", note: "Visitor collaboration: design sessions, signed plans, allowed paths, routine uploads, build status and security boundaries" },
  ingressWorker: { path: "workers/ingress/README.md", note: "Ingest Worker: reporter auth through Cloudflare Access, validation, splitting reports" },
  collectorWorker: { path: "workers/collector/README.md", note: "Collector Worker: scheduled pulls from Apple Music, GitHub, Vercel and other services" },
  macHub: { repo: HUB_REPO, path: "README.md", note: "MacTelemetryHub, the macOS/iOS app that reports LYJW's Mac and iPhone (foreground app, music, chargers, activity rings)" },
  iosApp: { path: "apps/ios/README.md", note: "iOS app in this repo: system music, health reporting, widgets, shortcuts" },
  serverReporter: { path: "reporters/server-reporter/README.md", note: "Reporter for the exit-node server's uptime, CPU, memory and traffic" },
  agentsReporter: { path: "reporters/agents-reporter/README.md", note: "Reporter for coding agent account plans and rate limits" },
  embyReporter: { path: "reporters/emby-reporter/README.md", note: "Reporter for what LYJW watches on Emby" },
  playstationReporter: { path: "reporters/playstation-reporter/README.md", note: "Reporter for PlayStation presence, games and trophies" },
  discordReporter: { path: "reporters/discord-reporter/README.md", note: "Reporter for Meta Quest playing status, read from Discord presence" },
} as const satisfies Record<string, { repo?: string; path: string; note: string }>;

export type ProjectDocKey = keyof typeof PROJECT_DOCS;
const DOC_KEYS = Object.keys(PROJECT_DOCS) as ProjectDocKey[];

// 文档进上下文就是输入 token 花费，且多为中文：一次读取最多 MAX_DOC_CHARS，一条回复合计最多读 MAX_DOC_READS_PER_REPLY 次，
// 长文档先给目录再按章节读，不整篇塞进去。
const MAX_DOC_CHARS = 8_000;
const MAX_DOC_READS_PER_REPLY = 4;
const MAX_SECTION_CHARS = 120;
// 与 raw.githubusercontent.com 返回的 max-age 对齐：访客连问不重复回源，main 上的改动几分钟内可见。
const DOC_CACHE_SECONDS = 300;

export function isProjectDocKey(value: unknown): value is ProjectDocKey {
  return DOC_KEYS.includes(value as ProjectDocKey);
}

export function projectDocPath(key: ProjectDocKey): string {
  const doc: { repo?: string; path: string } = PROJECT_DOCS[key];
  return doc.repo ? `${doc.repo.replace("https://github.com/", "")}/${doc.path}` : doc.path;
}

export function projectDocUrl(key: ProjectDocKey, kind: "blob" | "raw"): string {
  const doc: { repo?: string; path: string } = PROJECT_DOCS[key];
  const repo = doc.repo ?? site.repo;
  return kind === "blob"
    ? `${repo}/blob/main/${doc.path}`
    : `${repo.replace("https://github.com/", "https://raw.githubusercontent.com/")}/main/${doc.path}`;
}

export const fetchProjectDoc: ReadDoc = (url) =>
  fetch(url, { cf: { cacheTtl: DOC_CACHE_SECONDS, cacheEverything: true } });

export type ProjectDocRequest = { doc: ProjectDocKey; section?: string };

export function parseProjectDocInput(input: unknown): ProjectDocRequest | null {
  const { doc, section } = (input ?? {}) as { doc?: unknown; section?: unknown };
  if (!isProjectDocKey(doc)) return null;
  const heading = typeof section === "string" ? section.trim().slice(0, MAX_SECTION_CHARS) : "";
  return heading ? { doc, section: heading } : { doc };
}

const normalize = (text: string) => text.replace(/[`*_]/g, "").trim().toLowerCase();

// 同步调用：同一轮并行的几次调用按顺序先占好额度再并行去读，与 site-status.ts#claimViews 同理。
export function claimDoc(request: ProjectDocRequest, read: Set<string>): { read: boolean; note?: string } {
  const key = `${request.doc}#${normalize(request.section ?? "")}`;
  if (read.has(key)) return { read: false, note: "Already read earlier in this reply, reuse that result." };
  if (read.size >= MAX_DOC_READS_PER_REPLY) {
    return { read: false, note: `Not read, this reply may read at most ${MAX_DOC_READS_PER_REPLY} docs or sections.` };
  }
  read.add(key);
  return { read: true };
}

type Heading = { level: number; title: string; line: number };

function headings(lines: string[]): Heading[] {
  const found: Heading[] = [];
  let fence: string | null = null;
  lines.forEach((line, index) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker.startsWith(fence)) fence = null;
      return;
    }
    if (fence) return;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) found.push({ level: match[1].length, title: match[2], line: index });
  });
  return found;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text);

export function sliceDoc(markdown: string, section?: string): { text: string; heading?: string } {
  const lines = markdown.split("\n");
  const all = headings(lines);
  const outline = `Outline:\n${all.map((h) => `${"  ".repeat(h.level - 1)}- ${h.title}`).join("\n")}`;
  if (!section) {
    if (markdown.length <= MAX_DOC_CHARS) return { text: markdown };
    const opening = Math.max(0, MAX_DOC_CHARS - outline.length);
    return { text: `${outline}\n\nOpening:\n${clip(markdown, opening)}\n\nCall again with section set to a heading above to read that part.` };
  }
  const wanted = normalize(section);
  const start = all.find((h) => normalize(h.title) === wanted) ?? all.find((h) => normalize(h.title).includes(wanted));
  if (!start) return { text: `No heading matches "${section}".\n\n${clip(outline, MAX_DOC_CHARS)}` };
  const end = all.find((h) => h.line > start.line && h.level <= start.level)?.line ?? lines.length;
  return { text: clip(lines.slice(start.line, end).join("\n"), MAX_DOC_CHARS), heading: start.title };
}

// 文档多是中文，模型读完常跟着文档的语言回答；提醒放在每次读到的正文前面，比放在工具说明里管用。
const LANGUAGE_NOTE = "Answer in the language of the user's latest message, not the doc's; translate what you use.";

export async function readProjectDoc(
  read: ReadDoc,
  request: ProjectDocRequest,
): Promise<{ ok: boolean; text: string; heading?: string }> {
  const header = `Source: ${projectDocUrl(request.doc, "blob")}`;
  try {
    const response = await read(projectDocUrl(request.doc, "raw"));
    if (!response.ok) return { ok: false, text: `${header}\n\n${JSON.stringify({ error: `HTTP ${response.status}` })}` };
    const { text, heading } = sliceDoc(await response.text(), request.section);
    return { ok: true, text: `${header}\n${LANGUAGE_NOTE}\n\n${text}`, heading };
  } catch {
    return { ok: false, text: `${header}\n\n${JSON.stringify({ error: "unavailable" })}` };
  }
}

export const PROJECT_DOC_TOOL: SiteTool = {
  name: "read_project_doc",
  title: "Read the site's design docs",
  description: [
    "Read the design docs of this site's open-source code (GitHub, main branch). Most are written in Chinese.",
    "A short doc comes back whole. A long one comes back as its outline of headings plus the opening; call again with section set to a heading to read that part.",
    "Docs:",
    ...DOC_KEYS.map((key) => `- ${key} (${projectDocPath(key)}): ${PROJECT_DOCS[key].note}`),
  ].join("\n"),
  replyCap: `Each reply may read at most ${MAX_DOC_READS_PER_REPLY} docs or sections, so pick the most relevant one first.`,
  inputSchema: {
    type: "object",
    properties: {
      doc: { type: "string", enum: DOC_KEYS, description: "Which doc to read" },
      section: { type: "string", description: "A heading from the doc's outline; omit to get the whole doc or its outline" },
    },
    required: ["doc"],
    additionalProperties: false,
  },
  // 额度在第一个 await 之前占好（claimDoc 的前提）。
  async run(input, { readDoc }, ledger) {
    const request = parseProjectDocInput(input);
    if (!request) return { text: "Unknown doc; the valid docs are listed in the tool description.", isError: true };
    const claim = claimDoc(request, ledger.docs);
    if (!claim.read) return { text: claim.note ?? "Not read.", isError: true };
    const { ok, text, heading } = await readProjectDoc(readDoc, request);
    return { text, isError: !ok, ...(ok && { doc: { key: request.doc, ...(heading && { heading }) } }) };
  },
};

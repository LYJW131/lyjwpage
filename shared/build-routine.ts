export const BUILD_PATH = "/api/build";
export const BUILD_SESSION_PATH = "/api/build/session";
export const BUILD_CHAT_PATH = "/api/build/chat";
export const BUILD_REPO = "LYJW131/lyjwpage";

// 规划对话直接花 API 额度：这几项共同限定单次请求的最大花费，放宽前先算账。
export const BUILD_CHAT_LIMITS = {
  maxMessages: 24,
  maxMessageChars: 2000,
  maxReplyChars: 4000,
  maxTotalChars: 24000,
  maxToolRounds: 4,
} as const;

export const BUILD_PLAN_LIMITS = {
  titleChars: 72,
  bodyChars: 6000,
  acceptanceItems: 8,
  acceptanceChars: 300,
} as const;

// 按 GitHub 账号与全站各计一道，窗口一小时：routine 自身的触发上限按整个账号算，一个访客不能把它用光。
export const BUILD_QUOTA = {
  windowMs: 60 * 60 * 1000,
  chat: { account: 40, everyone: 300 },
  fire: { account: 3, everyone: 10 },
} as const;

// 须与 docs/build-routine.md 里 routine 提示词的分支名、.github/workflows/build-pr.yml 的 runId 格式同步：/build 靠它把 PR 认回对应的那次提交。
const BRANCH_PREFIX = "claude/build-";
const RUN_ID = /^[a-z0-9]{8}$/;

export type BuildFireResult = { runId: string; branch: string; sessionUrl: string };

// session 是 Worker 签发的不透明串，浏览器原样存、原样回传；login / name 只给页面显示。
export type BuildSession = { session: string; login: string; name: string | null; expiresAt: number };

// 计划只由规划模型经 propose_build 写出，访客改不了：Worker 校验后连同账号签成 token，触发端点只认这个 token。
export type BuildPlan = { title: string; body: string; acceptance: string[] };

// plan 是 Worker 签的计划 token，浏览器原样存、原样回传；seal 盖在「访客那句 + 这条回复 + plan」上，并绑定 GitHub 账号。
export type BuildChatMessage = { role: "user" | "assistant"; content: string; plan?: string; seal?: string };

// 响应体是 NDJSON，每行一个事件。plan 带着可直接触发的 token 与明文计划；seal 在回复完整结束时最后一行下发。
export type BuildChatEvent =
  | { type: "text"; text: string }
  | { type: "doc"; doc: string; url: string }
  | { type: "plan"; plan: BuildPlan; token: string; expiresAt: number }
  | { type: "seal"; seal: string }
  | { type: "error"; error: string };

export function newRunId(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}

export function branchForRun(runId: string): string {
  return `${BRANCH_PREFIX}${runId}`;
}

export function runIdFromBranch(ref: string): string | null {
  if (!ref.startsWith(BRANCH_PREFIX)) return null;
  const runId = ref.slice(BRANCH_PREFIX.length);
  return RUN_ID.test(runId) ? runId : null;
}

export function parseBuildPlan(value: unknown): BuildPlan | null {
  if (!value || typeof value !== "object") return null;
  const { title, body, acceptance } = value as Record<string, unknown>;
  if (typeof title !== "string" || typeof body !== "string" || !Array.isArray(acceptance)) return null;
  const cleanTitle = title.replace(/\s+/g, " ").trim();
  const cleanBody = body.trim();
  if (!cleanTitle || cleanTitle.length > BUILD_PLAN_LIMITS.titleChars) return null;
  if (!cleanBody || cleanBody.length > BUILD_PLAN_LIMITS.bodyChars) return null;
  if (acceptance.length === 0 || acceptance.length > BUILD_PLAN_LIMITS.acceptanceItems) return null;
  const items: string[] = [];
  for (const item of acceptance) {
    if (typeof item !== "string") return null;
    const text = item.trim();
    if (!text || text.length > BUILD_PLAN_LIMITS.acceptanceChars) return null;
    items.push(text);
  }
  return { title: cleanTitle, body: cleanBody, acceptance: items };
}

// 访客自己的话超长就拒；模型的旧回复只截断，超出总量从最早的消息丢起。浏览器发送前先过一遍，Worker 收到后再过一遍。
export function clipBuildReply(content: string): string {
  return content.length > BUILD_CHAT_LIMITS.maxReplyChars ? `${content.slice(0, BUILD_CHAT_LIMITS.maxReplyChars)}…` : content;
}

export function fitBuildHistory(messages: BuildChatMessage[]): BuildChatMessage[] {
  const clipped = messages
    .slice(-BUILD_CHAT_LIMITS.maxMessages)
    .map((m) => (m.role === "assistant" ? { ...m, content: clipBuildReply(m.content) } : m));
  let total = clipped.reduce((sum, m) => sum + m.content.length, 0);
  while (clipped.length > 1 && total > BUILD_CHAT_LIMITS.maxTotalChars) total -= clipped.shift()!.content.length;
  while (clipped.length && clipped[0].role !== "user") clipped.shift();
  return clipped;
}

export function parseBuildChatMessages(value: unknown): BuildChatMessage[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parsed: BuildChatMessage[] = [];
  for (const message of value.slice(-BUILD_CHAT_LIMITS.maxMessages)) {
    if (!message || typeof message !== "object") return null;
    const { role, content, plan, seal } = message as Record<string, unknown>;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    const text = content.trim();
    if (role === "user" && (!text || text.length > BUILD_CHAT_LIMITS.maxMessageChars)) return null;
    const cleanPlan = role === "assistant" && typeof plan === "string" && plan.length <= 16_000 ? plan : undefined;
    const cleanSeal = role === "assistant" && typeof seal === "string" && /^[\w-]{20,100}$/.test(seal) ? seal : undefined;
    parsed.push({ role, content: text, ...(cleanPlan && { plan: cleanPlan }), ...(cleanSeal && { seal: cleanSeal }) });
  }
  const fitted = fitBuildHistory(parsed);
  if (!fitted.length || fitted[fitted.length - 1].role !== "user") return null;
  return fitted;
}

// 契约：routine 收到的 fire text 就是这个 JSON 字符串。提示词按字段取值；plan 是规划对话定下的计划；coauthor 是一行 `Name <email>`，由 Worker 按验证过的 GitHub 身份拼好，routine 原样写进提交的 Co-authored-by。
export function fireText(runId: string, plan: BuildPlan, coauthor: string): string {
  return JSON.stringify({ runId, plan, coauthor });
}

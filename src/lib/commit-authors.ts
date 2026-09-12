/**
 * 一条提交的署名：作者加 `Co-authored-by:` 尾注里的协作者，GitHub 提交页那一行的数据源。
 *
 * GitHub 用邮箱把协作者对回账号；这里只认两类能离线解析的：`<id>+<login>@users.noreply.github.com`
 * 直接拼出头像，几家 coding agent 的固定邮箱换成品牌图标。其余只留名字，画首字母。
 */
export type CommitAuthor = {
  /** 显示名：GitHub 登录名，或尾注里的名字 */
  name: string;
  /** GitHub 登录名，有就能点到主页 */
  login: string | null;
  /** GitHub 头像（不带尺寸参数，展示侧按需加 `s=`） */
  avatarUrl: string | null;
  /** 没有 GitHub 头像的已知 agent，用品牌图标当头像 */
  agent: "claude" | "cursor" | "openai" | null;
};

const AGENT_EMAILS: { pattern: RegExp; name: string; agent: NonNullable<CommitAuthor["agent"]> }[] = [
  { pattern: /@anthropic\.com$/i, name: "claude", agent: "claude" },
  { pattern: /@cursor\.com$/i, name: "cursor", agent: "cursor" },
  { pattern: /@openai\.com$/i, name: "codex", agent: "openai" },
];

const GITHUB_NOREPLY = /^(\d+)\+([^@\s]+)@users\.noreply\.github\.com$/i;
const TRAILER = /^co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/i;

/** 尾注里一位协作者 → 署名；空名字、解析不出的邮箱也给出一个只带名字的条目。 */
export function authorFromTrailer(name: string, email: string): CommitAuthor {
  const github = GITHUB_NOREPLY.exec(email.trim());
  if (github) {
    return { name: github[2], login: github[2], avatarUrl: `https://avatars.githubusercontent.com/u/${github[1]}?v=4`, agent: null };
  }
  const agent = AGENT_EMAILS.find((entry) => entry.pattern.test(email.trim()));
  if (agent) return { name: agent.name, login: null, avatarUrl: null, agent: agent.agent };
  return { name: name.trim() || email.trim(), login: null, avatarUrl: null, agent: null };
}

/** 从提交全文里抽 `Co-authored-by` 尾注，保持出现顺序。 */
export function parseCoAuthors(message: string): CommitAuthor[] {
  const authors: CommitAuthor[] = [];
  for (const line of message.split(/\r?\n/)) {
    const match = TRAILER.exec(line.trim());
    if (match) authors.push(authorFromTrailer(match[1], match[2]));
  }
  return authors;
}

/** 作者在前，协作者按出现顺序接上；同一个人（登录名或显示名相同，不分大小写）只留第一次。 */
export function mergeAuthors(primary: CommitAuthor | null, coAuthors: CommitAuthor[]): CommitAuthor[] {
  const seen = new Set<string>();
  const result: CommitAuthor[] = [];
  for (const author of [...(primary ? [primary] : []), ...coAuthors]) {
    const key = (author.login ?? author.name).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(author);
  }
  return result;
}

/** GitHub 那句主语：`A`、`A and B`、`A, B, and C`。 */
export function joinAuthorNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

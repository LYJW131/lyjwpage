export type CommitAuthor = {
  name: string;
  login: string | null;
  avatarUrl: string | null;
  agent: "claude" | "cursor" | "openai" | null;
};

const AGENT_EMAILS: { pattern: RegExp; name: string; agent: NonNullable<CommitAuthor["agent"]>; login?: string; avatarUrl?: string }[] = [
  { pattern: /@anthropic\.com$/i, name: "claude", agent: "claude" },
  { pattern: /@cursor\.com$/i, name: "cursoragent", agent: "cursor", login: "cursoragent", avatarUrl: "https://avatars.githubusercontent.com/u/199161495?v=4" },
  { pattern: /@openai\.com$/i, name: "codex", agent: "openai" },
];

const GITHUB_NOREPLY = /^(?:(\d+)\+)?([^@\s]+)@users\.noreply\.github\.com$/i;
const TRAILER = /^co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/i;

export function authorFromTrailer(name: string, email: string): CommitAuthor {
  const github = GITHUB_NOREPLY.exec(email.trim());
  if (github) {
    const id = github[1];
    const login = github[2];
    const avatarUrl = id
      ? `https://avatars.githubusercontent.com/u/${id}?v=4`
      : `https://github.com/${login}.png`;
    return { name: login, login, avatarUrl, agent: null };
  }
  const agent = AGENT_EMAILS.find((entry) => entry.pattern.test(email.trim()));
  if (agent) {
    return {
      name: agent.name,
      login: agent.login ?? null,
      avatarUrl: agent.avatarUrl ?? null,
      agent: agent.agent,
    };
  }
  return { name: name.trim() || email.trim(), login: null, avatarUrl: null, agent: null };
}

export function parseCoAuthors(message: string): CommitAuthor[] {
  const authors: CommitAuthor[] = [];
  for (const line of message.split(/\r?\n/)) {
    const match = TRAILER.exec(line.trim());
    if (match) authors.push(authorFromTrailer(match[1], match[2]));
  }
  return authors;
}

export function mergeAuthors(primary: CommitAuthor | null, coAuthors: CommitAuthor[]): CommitAuthor[] {
  const seen = new Set<string>();
  const result: CommitAuthor[] = [];
  for (const author of [...(primary ? [primary] : []), ...coAuthors]) {
    const key = (author.agent ? `agent:${author.agent}` : (author.login ?? author.name)).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(author);
  }
  return result;
}

export function joinAuthorNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

export type CommitListItem = {
  sha?: string;
  html_url?: string;
  commit?: {
    message?: string;
    author?: { name?: string; email?: string; date?: string } | null;
    verification?: {
      verified?: boolean;
      reason?: string | null;
    } | null;
  };
  author?: { login?: string; avatar_url?: string } | null;
};

export function primaryAuthor(item: CommitListItem): CommitAuthor | null {
  const login = item.author?.login?.trim();
  const avatarUrl = item.author?.avatar_url?.trim() || null;

  if (login) {
    return {
      name: login,
      login,
      avatarUrl,
      agent: login === "cursoragent" ? "cursor" : null,
    };
  }

  const email = item.commit?.author?.email?.trim() || "";
  const name = item.commit?.author?.name?.trim() || "";
  if (email) {
    const candidate = authorFromTrailer(name, email);
    if (candidate.login || candidate.name || candidate.agent) return candidate;
  }

  return name ? { name, login: null, avatarUrl: null, agent: null } : null;
}

export function commitTitle(message: string): string {
  const line = message.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return line || "(untitled)";
}

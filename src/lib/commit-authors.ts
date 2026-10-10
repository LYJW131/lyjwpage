export type CommitAuthor = {
  name: string;
  login: string | null;
  avatarUrl: string | null;
  agent: "claude" | "cursor" | "openai" | "grok" | null;
  model: string | null;
};

const AGENTS: Record<string, { agent: NonNullable<CommitAuthor["agent"]>; login: string; avatarUrl: string }> = {
  "noreply@anthropic.com": { agent: "claude", login: "claude", avatarUrl: "https://avatars.githubusercontent.com/u/81847?v=4" },
  "codex@openai.com": { agent: "openai", login: "codex", avatarUrl: "https://avatars.githubusercontent.com/u/267193182?v=4" },
  "cursoragent@cursor.com": { agent: "cursor", login: "cursoragent", avatarUrl: "https://avatars.githubusercontent.com/u/199161495?v=4" },
  "304785771+grokkybara[bot]@users.noreply.github.com": { agent: "grok", login: "grokkybara[bot]", avatarUrl: "https://avatars.githubusercontent.com/in/4293548?v=4" },
};

function agentAuthor(name: string, email: string): CommitAuthor | null {
  const entry = AGENTS[email.trim().toLowerCase()];
  if (!entry) return null;
  return { name: entry.login, login: entry.login, avatarUrl: entry.avatarUrl, agent: entry.agent, model: name.trim() || null };
}

const GITHUB_NOREPLY = /^(?:(\d+)\+)?([^@\s]+)@users\.noreply\.github\.com$/i;
const TRAILER = /^co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/i;

export function authorFromTrailer(name: string, email: string): CommitAuthor {
  const agent = agentAuthor(name, email);
  if (agent) return agent;
  const github = GITHUB_NOREPLY.exec(email.trim());
  if (github) {
    const id = github[1];
    const login = github[2];
    const avatarUrl = id
      ? `https://avatars.githubusercontent.com/u/${id}?v=4`
      : `https://github.com/${login}.png`;
    return { name: login, login, avatarUrl, agent: null, model: null };
  }
  return { name: name.trim() || email.trim(), login: null, avatarUrl: null, agent: null, model: null };
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
    const key = (author.agent ? `agent:${author.agent}:${author.model ?? ""}` : (author.login ?? author.name)).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(author);
  }
  return result;
}

export function actorAuthor(actor: { name: string; email: string; login: string | null; avatarUrl: string | null }): CommitAuthor {
  return agentAuthor(actor.name, actor.email)
    ?? { name: actor.login ?? actor.name, login: actor.login, avatarUrl: actor.avatarUrl, agent: null, model: null };
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
  const email = item.commit?.author?.email?.trim() || "";
  const name = item.commit?.author?.name?.trim() || "";

  if (login) {
    return actorAuthor({ name, email, login, avatarUrl: item.author?.avatar_url?.trim() || null });
  }

  if (email) {
    const candidate = authorFromTrailer(name, email);
    if (candidate.login || candidate.name || candidate.agent) return candidate;
  }

  return name ? { name, login: null, avatarUrl: null, agent: null, model: null } : null;
}

export function commitTitle(message: string): string {
  const line = message.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return line || "(untitled)";
}

export const REPO = "LYJW131/lyjwpage";
const API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 30_000;

type Init = { method?: string; headers: Record<string, string>; body?: string; signal: AbortSignal };
export type FetchLike = (url: string, init: Init) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;
export type PatchId = (sha: string) => string | null;
type User = { login?: string; id?: number } | null | undefined;

export type Pull = {
  number: number;
  title: string;
  state: string;
  merged?: boolean;
  draft?: boolean;
  mergeable: boolean | null;
  mergeable_state?: string;
  head: { sha: string };
  base?: { ref: string };
  labels?: { name: string }[];
};
export type PrFile = { filename: string; previous_filename?: string };
export type CheckRun = { id?: number; name: string; status: string; conclusion: string | null; started_at?: string | null; html_url?: string };
export type Status = { context: string; state: string; target_url?: string | null };
export type Review = { user?: User; commit_id?: string | null };
export type ReviewComment = {
  id: number;
  in_reply_to_id?: number;
  user?: User;
  body?: string | null;
  html_url?: string;
  path?: string;
  line?: number | null;
  original_line?: number | null;
  created_at?: string;
};
export type IssueComment = { user?: User; body?: string | null };

function headers(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  return { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

export function client(fetchImpl: FetchLike) {
  const request = async <T>(url: string, init: Partial<Init> = {}): Promise<T> => {
    const response = await fetchImpl(url, { ...init, headers: headers(), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`${url.replace(API, "")} HTTP ${response.status}`);
    return (await response.json()) as T;
  };
  const get = <T>(path: string) => request<T>(`${API}/repos/${REPO}/${path}`);
  const all = async <T>(path: string): Promise<T[]> => {
    const items: T[] = [];
    for (let page = 1; ; page += 1) {
      const batch = await get<T[]>(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      items.push(...batch);
      if (batch.length < 100) return items;
    }
  };
  const graphql = (query: string, variables: Record<string, unknown>) =>
    request<{ data?: unknown; errors?: unknown }>(`${API}/graphql`, { method: "POST", body: JSON.stringify({ query, variables }) });
  return { get, all, graphql };
}
export type Client = ReturnType<typeof client>;

export function changedPaths(files: PrFile[]) {
  return files.flatMap((file) => (file.previous_filename ? [file.filename, file.previous_filename] : [file.filename]));
}

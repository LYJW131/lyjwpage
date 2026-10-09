"use client";

import { useMemo, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import useSWR from "swr";

import { Card } from "@/components/ui/card";
import { StatusDot, type DotTone } from "@/components/ui/status-dot";
import {
  BUILD_PATH,
  BUILD_REPO,
  BUILD_REQUEST_MAX_CHARS,
  BUILD_SESSION_PATH,
  runIdFromBranch,
  type BuildFireResult,
  type BuildSession,
} from "@shared/build-routine";
import { signInWithGithub } from "@/lib/github-sign-in";
import { cn } from "@/lib/utils";
import { workerUrl } from "@/lib/worker-url";

type Run = BuildFireResult & { request: string; firedAt: number };

type BuildPull = {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed" | "merged";
  runId: string;
  createdAt: string;
};

type GithubPull = {
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  merged_at: string | null;
  created_at: string;
  head: { ref: string; repo: { full_name: string } | null };
};

const FIRE_URL = workerUrl(process.env.NEXT_PUBLIC_BACKEND_URL, BUILD_PATH);
const SESSION_URL = workerUrl(process.env.NEXT_PUBLIC_BACKEND_URL, BUILD_SESSION_PATH);
const PULLS_URL = `https://api.github.com/repos/${BUILD_REPO}/pulls?state=all&sort=created&direction=desc&per_page=50`;

const RUNS_KEY = "build-runs";
const SESSION_KEY = "build-github-session";
const STORAGE_EVENT = "build-storage-change";
const MAX_RUNS = 20;
const POLL_MS = 60_000;

const timeFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const PULL_TONE: Record<BuildPull["state"], DotTone> = { open: "live", merged: "idle", closed: "off" };

function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(STORAGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(STORAGE_EVENT, onChange);
  };
}

function readStorage(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
  window.dispatchEvent(new Event(STORAGE_EVENT));
}

function parseRuns(raw: string): Run[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as Run[]) : [];
  } catch {
    return [];
  }
}

function parseSession(raw: string): BuildSession | null {
  try {
    const value = JSON.parse(raw) as Partial<BuildSession> | null;
    return typeof value?.session === "string" && typeof value.login === "string" ? (value as BuildSession) : null;
  } catch {
    return null;
  }
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message !== "Failed to fetch" ? err.message : fallback;
}

// 公开仓直接从浏览器读：用的是访客自己的匿名额度；默认缓存模式下过期后带 ETag 复查，304 不计额度。
async function fetchPulls(url: string): Promise<BuildPull[]> {
  const response = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(`GitHub ${response.status}`);
  const pulls: BuildPull[] = [];
  for (const pull of (await response.json()) as GithubPull[]) {
    const runId = runIdFromBranch(pull.head.ref);
    if (!runId || pull.head.repo?.full_name !== BUILD_REPO) continue;
    pulls.push({
      number: pull.number,
      title: pull.title,
      url: pull.html_url,
      state: pull.merged_at ? "merged" : pull.state,
      runId,
      createdAt: pull.created_at,
    });
  }
  return pulls;
}

export function BuildConsole() {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 本页刚发起的运行另存一份：localStorage 不可用时列表照样能显示。
  const [fresh, setFresh] = useState<Run[]>([]);

  const [connecting, setConnecting] = useState(false);

  const storedRuns = useSyncExternalStore(subscribeStorage, () => readStorage(RUNS_KEY), () => "");
  const runs = useMemo(() => {
    const seen = new Set<string>();
    return [...fresh, ...parseRuns(storedRuns)].filter((run) => !seen.has(run.runId) && seen.add(run.runId));
  }, [fresh, storedRuns]);
  const storedSession = useSyncExternalStore(subscribeStorage, () => readStorage(SESSION_KEY), () => "");
  const session = useMemo(() => parseSession(storedSession), [storedSession]);

  const { data: pulls, error: pullsError } = useSWR<BuildPull[]>(PULLS_URL, fetchPulls, {
    refreshInterval: POLL_MS,
    revalidateOnFocus: true,
  });
  const pullByRun = useMemo(() => new Map((pulls ?? []).map((pull) => [pull.runId, pull])), [pulls]);

  const request = draft.trim();
  const canSubmit = !!session && !pending && request.length > 0 && request.length <= BUILD_REQUEST_MAX_CHARS;

  async function connect() {
    if (!SESSION_URL) {
      setError("The backend URL isn't configured.");
      return;
    }
    setError(null);
    setConnecting(true);
    try {
      const code = await signInWithGithub();
      const response = await fetch(SESSION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await response.json().catch(() => null)) as (BuildSession & { error?: string }) | null;
      if (!response.ok || !data?.session) throw new Error(data?.error ?? `GitHub sign-in failed (HTTP ${response.status}).`);
      writeStorage(SESSION_KEY, JSON.stringify(data));
    } catch (err) {
      setError(errorMessage(err, "Couldn't reach the build endpoint."));
    } finally {
      setConnecting(false);
    }
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSubmit) return;
    if (!FIRE_URL) {
      setError("The backend URL isn't configured.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(FIRE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request, session: session?.session }),
      });
      const data = (await response.json().catch(() => null)) as (BuildFireResult & { error?: string }) | null;
      if (response.status === 401) writeStorage(SESSION_KEY, null);
      if (!response.ok || !data?.sessionUrl) {
        setError(data?.error ?? `Request failed (HTTP ${response.status}).`);
        return;
      }
      const run: Run = { runId: data.runId, branch: data.branch, sessionUrl: data.sessionUrl, request, firedAt: Date.now() };
      setFresh((current) => [run, ...current]);
      writeStorage(RUNS_KEY, JSON.stringify([run, ...parseRuns(readStorage(RUNS_KEY))].slice(0, MAX_RUNS)));
      setDraft("");
    } catch {
      setError("Couldn't reach the build endpoint.");
    } finally {
      setPending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit();
  }

  return (
    <div className="flex flex-col gap-4">
      <Card label="BUILD" action="Claude Code routine">
        <form onSubmit={submit} className="flex flex-col gap-3 p-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Describe a change to this site. A Claude Code cloud session implements it on its own branch and opens a
            pull request against <span className="font-mono text-foreground">main</span>.
          </p>
          {session ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 font-mono text-[11px] text-muted-foreground">
              <span className="min-w-0 truncate">
                Connected as{" "}
                <a href={`https://github.com/${session.login}`} target="_blank" rel="noreferrer noopener" className="text-foreground underline underline-offset-2">
                  @{session.login}
                </a>{" "}
                · credited as co-author
              </span>
              <button type="button" onClick={() => writeStorage(SESSION_KEY, null)} className="shrink-0 hover:text-foreground">
                Sign out
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
              <span className="text-sm text-muted-foreground">Connect GitHub to start a build.</span>
              <button
                type="button"
                onClick={() => void connect()}
                disabled={connecting}
                className="h-8 shrink-0 rounded-md border border-line-strong bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover disabled:opacity-40"
              >
                {connecting ? "Connecting…" : "Connect GitHub"}
              </button>
            </div>
          )}
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="e.g. Make the footer links underline on hover"
            aria-label="Change request"
            rows={5}
            className="scrollbar-none min-h-32 max-h-80 resize-none rounded-md border border-line bg-background px-3 py-2 text-base text-foreground outline-none [field-sizing:content] focus:border-foreground/40 sm:text-sm [&::-webkit-scrollbar]:hidden"
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex items-center justify-between gap-3">
            <span
              className={cn(
                "label-mono",
                request.length > BUILD_REQUEST_MAX_CHARS ? "text-red-500" : "text-muted-foreground",
              )}
            >
              {request.length.toLocaleString("en-US")} / {BUILD_REQUEST_MAX_CHARS.toLocaleString("en-US")}
            </span>
            <button
              type="submit"
              disabled={!canSubmit}
              className="h-8 shrink-0 rounded-md bg-foreground px-4 text-xs font-medium text-background transition-opacity disabled:opacity-40"
            >
              {pending ? "Starting…" : "Start build"}
            </button>
          </div>
        </form>
      </Card>

      {runs.length > 0 && (
        <Card label="THIS BROWSER" action={`${runs.length} run${runs.length === 1 ? "" : "s"}`}>
          <ul className="divide-y divide-line">
            {runs.map((run) => {
              const pull = pullByRun.get(run.runId);
              return (
                <li key={run.runId} className="flex flex-col gap-1.5 px-4 py-3">
                  <p className="line-clamp-2 text-sm text-foreground">{run.request}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                    <span>{timeFormat.format(run.firedAt)}</span>
                    <a href={run.sessionUrl} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-foreground">
                      Session
                    </a>
                    {pull ? (
                      <a href={pull.url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1.5 underline underline-offset-2 hover:text-foreground">
                        <StatusDot tone={PULL_TONE[pull.state]} />#{pull.number} {pull.state}
                      </a>
                    ) : (
                      <span>Waiting for PR on {run.branch}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card label="BUILD PULL REQUESTS" action={pulls ? `${pulls.length}` : undefined}>
        {pullsError ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">Couldn&apos;t load pull requests from GitHub.</p>
        ) : !pulls ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>
        ) : pulls.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">No build pull requests yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {pulls.map((pull) => (
              <li key={pull.number}>
                <a
                  href={pull.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex min-h-11 items-center gap-3 px-4 py-2 transition-colors hover:bg-surface-hover"
                >
                  <StatusDot tone={PULL_TONE[pull.state]} />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{pull.title}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    #{pull.number} · {timeFormat.format(new Date(pull.createdAt))}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

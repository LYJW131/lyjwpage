"use client";

import { useMemo, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import useSWR from "swr";

import { ChatMarkdown } from "@/components/chat-markdown";
import { Card } from "@/components/ui/card";
import { StatusDot, type DotTone } from "@/components/ui/status-dot";
import {
  BUILD_CHAT_LIMITS,
  BUILD_CHAT_PATH,
  BUILD_PATH,
  BUILD_REPO,
  BUILD_SESSION_PATH,
  fitBuildHistory,
  runIdFromBranch,
  type BuildChatEvent,
  type BuildChatMessage,
  type BuildFireResult,
  type BuildPlan,
  type BuildSession,
} from "@shared/build-routine";
import { signInWithGithub } from "@/lib/github-sign-in";
import { cn } from "@/lib/utils";
import { workerUrl } from "@/lib/worker-url";

type Run = BuildFireResult & { title: string; plan: string; firedAt: number };

type ChatEntry = BuildChatMessage & {
  proposal?: { plan: BuildPlan; expiresAt: number };
  docs?: { doc: string; url: string }[];
};

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
const CHAT_URL = workerUrl(process.env.NEXT_PUBLIC_BACKEND_URL, BUILD_CHAT_PATH);
const SESSION_URL = workerUrl(process.env.NEXT_PUBLIC_BACKEND_URL, BUILD_SESSION_PATH);
const PULLS_URL = `https://api.github.com/repos/${BUILD_REPO}/pulls?state=all&sort=created&direction=desc&per_page=50`;

const RUNS_KEY = "build-runs";
const SESSION_KEY = "build-github-session";
const CHAT_KEY = "build-chat";
const STORAGE_EVENT = "build-storage-change";
const MAX_RUNS = 20;
const POLL_MS = 60_000;
const OFFLINE = "Couldn't reach the build endpoint.";

const timeFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const clockFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

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

function parseList<T>(raw: string, valid: (item: T) => boolean): T[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as T[]).filter((item) => item && typeof item === "object" && valid(item)) : [];
  } catch {
    return [];
  }
}

const parseRuns = (raw: string) => parseList<Run>(raw, (run) => typeof run.title === "string" && typeof run.runId === "string");
const parseChat = (raw: string) =>
  parseList<ChatEntry>(raw, (m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string");

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

const BUTTON = "h-8 shrink-0 rounded-md px-3 text-xs font-medium transition-opacity disabled:opacity-40";

function PlanCard({
  proposal,
  latest,
  run,
  starting,
  onStart,
}: {
  proposal: NonNullable<ChatEntry["proposal"]>;
  latest: boolean;
  run: Run | undefined;
  starting: boolean;
  onStart: () => void;
}) {
  const { plan, expiresAt } = proposal;
  return (
    <div className={cn("mt-3 flex flex-col gap-2 rounded-md border bg-background p-3", latest ? "border-line-strong" : "border-line opacity-60")}>
      <div className="flex items-center justify-between gap-3">
        <span className="label-mono text-muted-foreground">PLAN</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {run ? "Started" : latest ? `Valid until ${clockFormat.format(expiresAt)}` : "Superseded"}
        </span>
      </div>
      <p className="font-medium text-foreground">{plan.title}</p>
      <ChatMarkdown>{plan.body}</ChatMarkdown>
      <div>
        <p className="label-mono text-muted-foreground">ACCEPTANCE</p>
        <ul className="mt-1 list-disc pl-5 text-sm">
          {plan.acceptance.map((item, index) => (
            <li key={index} className="my-0.5">
              {item}
            </li>
          ))}
        </ul>
      </div>
      {latest && (
        <div className="flex items-center justify-end gap-3">
          {run ? (
            <a href={run.sessionUrl} target="_blank" rel="noreferrer noopener" className="font-mono text-[11px] underline underline-offset-2 hover:text-foreground">
              Open session
            </a>
          ) : (
            <button type="button" onClick={onStart} disabled={starting} className={cn(BUTTON, "bg-foreground text-background")}>
              {starting ? "Starting…" : "Start build"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function BuildConsole() {
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  // 本页的对话与运行另存一份：localStorage 不可用时照样能显示。
  const [chat, setChat] = useState<ChatEntry[] | null>(null);
  const [fresh, setFresh] = useState<Run[]>([]);

  const storedRuns = useSyncExternalStore(subscribeStorage, () => readStorage(RUNS_KEY), () => "");
  const runs = useMemo(() => {
    const seen = new Set<string>();
    return [...fresh, ...parseRuns(storedRuns)].filter((run) => !seen.has(run.runId) && seen.add(run.runId));
  }, [fresh, storedRuns]);
  const runByPlan = useMemo(() => new Map(runs.map((run) => [run.plan, run])), [runs]);
  const storedSession = useSyncExternalStore(subscribeStorage, () => readStorage(SESSION_KEY), () => "");
  const session = useMemo(() => parseSession(storedSession), [storedSession]);
  const storedChat = useSyncExternalStore(subscribeStorage, () => readStorage(CHAT_KEY), () => "");
  const messages = useMemo(() => chat ?? parseChat(storedChat), [chat, storedChat]);
  const latestPlan = useMemo(() => messages.findLast((m) => m.plan)?.plan, [messages]);

  const { data: pulls, error: pullsError } = useSWR<BuildPull[]>(PULLS_URL, fetchPulls, {
    refreshInterval: POLL_MS,
    revalidateOnFocus: true,
  });
  const pullByRun = useMemo(() => new Map((pulls ?? []).map((pull) => [pull.runId, pull])), [pulls]);

  const text = draft.trim();
  const canSend = !!session && !streaming && text.length > 0 && text.length <= BUILD_CHAT_LIMITS.maxMessageChars;

  function saveChat(next: ChatEntry[]) {
    setChat(next);
    writeStorage(CHAT_KEY, next.length ? JSON.stringify(next) : null);
  }

  function signOut() {
    writeStorage(SESSION_KEY, null);
    saveChat([]);
  }

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
      setError(errorMessage(err, OFFLINE));
    } finally {
      setConnecting(false);
    }
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend || !session) return;
    if (!CHAT_URL) {
      setError("The backend URL isn't configured.");
      return;
    }
    const asked: ChatEntry[] = [...messages, { role: "user", content: text }];
    const history = fitBuildHistory(asked.map(({ role, content, plan, seal }) => ({ role, content, plan, seal })));
    let reply: ChatEntry = { role: "assistant", content: "" };
    const show = () => setChat([...asked, reply]);
    show();
    setDraft("");
    setError(null);
    setStreaming(true);
    try {
      const response = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, session: session.session }),
      });
      if (response.status === 401) writeStorage(SESSION_KEY, null);
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Request failed (HTTP ${response.status}).`);
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const update = JSON.parse(line) as BuildChatEvent;
          if (update.type === "text") reply = { ...reply, content: reply.content + update.text };
          else if (update.type === "doc") reply = { ...reply, docs: [...(reply.docs ?? []), { doc: update.doc, url: update.url }] };
          else if (update.type === "plan") reply = { ...reply, plan: update.token, proposal: { plan: update.plan, expiresAt: update.expiresAt } };
          else if (update.type === "seal") reply = { ...reply, seal: update.seal };
          else if (update.type === "error") setError(update.error);
        }
        show();
      }
    } catch (err) {
      setError(errorMessage(err, OFFLINE));
    } finally {
      const kept = reply.content.trim() || reply.plan;
      saveChat(kept ? [...asked, { ...reply, content: reply.content.trim() }] : messages);
      if (!kept) setDraft((current) => current || text);
      setStreaming(false);
    }
  }

  async function start(entry: ChatEntry) {
    if (!session || !entry.plan || !entry.proposal || starting) return;
    if (!FIRE_URL) {
      setError("The backend URL isn't configured.");
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const response = await fetch(FIRE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: entry.plan, session: session.session }),
      });
      const data = (await response.json().catch(() => null)) as (BuildFireResult & { error?: string }) | null;
      if (response.status === 401) writeStorage(SESSION_KEY, null);
      if (!response.ok || !data?.sessionUrl) {
        setError(data?.error ?? `Request failed (HTTP ${response.status}).`);
        return;
      }
      const run: Run = { ...data, title: entry.proposal.plan.title, plan: entry.plan, firedAt: Date.now() };
      setFresh((current) => [run, ...current]);
      writeStorage(RUNS_KEY, JSON.stringify([run, ...parseRuns(readStorage(RUNS_KEY))].slice(0, MAX_RUNS)));
    } catch {
      setError(OFFLINE);
    } finally {
      setStarting(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
  }

  return (
    <div className="flex flex-col gap-4">
      <Card label="BUILD" action="Claude Code routine">
        <div className="flex flex-col gap-3 p-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Describe a change to this site and talk it through with the planner. When the plan is ready, start the
            build: a Claude Code cloud session implements the plan on its own branch and opens a pull request against{" "}
            <span className="font-mono text-foreground">main</span> for review.
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
              <button type="button" onClick={signOut} className="shrink-0 hover:text-foreground">
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
                className={cn(BUTTON, "border border-line-strong bg-surface text-foreground hover:bg-surface-hover")}
              >
                {connecting ? "Connecting…" : "Connect GitHub"}
              </button>
            </div>
          )}

          {messages.length > 0 && (
            <div className="flex flex-col gap-3">
              {messages.map((message, index) => (
                <div key={index} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "min-w-0 rounded-lg px-3 py-2 text-sm leading-relaxed [overflow-wrap:anywhere]",
                      message.role === "user"
                        ? "max-w-[85%] whitespace-pre-wrap bg-foreground text-background"
                        : "w-full border border-line bg-muted text-foreground sm:max-w-[85%]",
                    )}
                  >
                    {message.docs?.length ? (
                      <p className="mb-1 font-mono text-[11px] text-muted-foreground">
                        Read{" "}
                        {message.docs.map((doc, i) => (
                          <span key={i}>
                            {i > 0 && ", "}
                            <a href={doc.url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-foreground">
                              {doc.doc}
                            </a>
                          </span>
                        ))}
                      </p>
                    ) : null}
                    {message.role === "user" ? (
                      message.content
                    ) : message.content ? (
                      <ChatMarkdown>{message.content}</ChatMarkdown>
                    ) : !message.proposal && streaming && index === messages.length - 1 ? (
                      <span className="text-muted-foreground">Thinking…</span>
                    ) : null}
                    {message.proposal && message.plan && (
                      <PlanCard
                        proposal={message.proposal}
                        latest={message.plan === latestPlan}
                        run={runByPlan.get(message.plan)}
                        starting={starting}
                        onStart={() => void start(message)}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}
          <form onSubmit={send} className="flex flex-col gap-3">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              disabled={!session}
              placeholder={messages.length ? "Reply to the planner" : "What should change? e.g. Make the footer links underline on hover"}
              aria-label="Message to the planner"
              rows={3}
              className="scrollbar-none min-h-20 max-h-60 resize-none rounded-md border border-line bg-background px-3 py-2 text-base text-foreground outline-none [field-sizing:content] focus:border-foreground/40 disabled:opacity-60 sm:text-sm [&::-webkit-scrollbar]:hidden"
            />
            <div className="flex items-center justify-between gap-3">
              <span
                className={cn(
                  "label-mono",
                  text.length > BUILD_CHAT_LIMITS.maxMessageChars ? "text-red-500" : "text-muted-foreground",
                )}
              >
                {text.length.toLocaleString("en-US")} / {BUILD_CHAT_LIMITS.maxMessageChars.toLocaleString("en-US")}
              </span>
              <div className="flex items-center gap-2">
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => saveChat([])}
                    disabled={streaming}
                    className={cn(BUTTON, "border border-line text-muted-foreground hover:text-foreground")}
                  >
                    New chat
                  </button>
                )}
                <button type="submit" disabled={!canSend} className={cn(BUTTON, "bg-foreground px-4 text-background")}>
                  {streaming ? "Planning…" : "Send"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </Card>

      {runs.length > 0 && (
        <Card label="THIS BROWSER" action={`${runs.length} run${runs.length === 1 ? "" : "s"}`}>
          <ul className="divide-y divide-line">
            {runs.map((run) => {
              const pull = pullByRun.get(run.runId);
              return (
                <li key={run.runId} className="flex flex-col gap-1.5 px-4 py-3">
                  <p className="line-clamp-2 text-sm text-foreground">{run.title}</p>
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

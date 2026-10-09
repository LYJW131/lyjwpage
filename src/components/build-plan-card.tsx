"use client";

import { useEffect, useRef, useState } from "react";

import { ChatMarkdown } from "@/components/chat-markdown";
import { IssuePanel } from "@/components/github-issue-panel";
import type { ChatProposal } from "@/lib/chat-archive";
import { signInWithGithub } from "@/lib/github-sign-in";
import { workerUrl } from "@/lib/worker-url";
import { BUILD_PATH, BUILD_SESSION_PATH, BUILD_STATUS_PATH, type BuildFireResult, type BuildPhase, type BuildRun, type BuildSession, type BuildSignal } from "@shared/build-routine";

const BUILD_URL = workerUrl(process.env.NEXT_PUBLIC_BACKEND_URL, BUILD_PATH);
const SESSION_URL = workerUrl(process.env.NEXT_PUBLIC_BACKEND_URL, BUILD_SESSION_PATH);
const STATUS_URL = workerUrl(process.env.NEXT_PUBLIC_BACKEND_URL, BUILD_STATUS_PATH);
const POLL_MS = 10_000;
let githubSession: BuildSession | null = null;

const phaseLabels: Record<BuildPhase, string> = {
  triggered: "Build requested",
  running: "In progress",
  uploaded: "Changes uploaded",
  validated: "Changes validated",
  blocked: "Blocked",
  pr_open: "Pull request opened",
  merged: "Merged",
  closed: "Closed",
  timeout: "Timed out · result unknown",
  failed: "Build failed",
};

export function BuildPlanCard({ proposal, onChange, inactive = false }: { proposal: ChatProposal; onChange: (proposal: ChatProposal) => void; inactive?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  const [issueOpen, setIssueOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expired = now >= proposal.expiresAt;
  const used = Boolean(proposal.issue || proposal.build);
  const disabled = expired || used || working || inactive;

  useEffect(() => {
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, proposal.expiresAt - Date.now()) + 20);
    return () => clearTimeout(timer);
  }, [proposal.expiresAt]);

  async function startBuild() {
    if (disabled) return;
    setWorking(true);
    setError(null);
    try {
      if (!BUILD_URL || !SESSION_URL) throw new Error("Builds are offline right now.");
      if (!githubSession || githubSession.expiresAt <= Date.now()) {
        const signIn = await signInWithGithub();
        const response = await fetch(SESSION_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signIn) });
        const session = await response.json() as BuildSession & { error?: string };
        if (!response.ok || !session.session) throw new Error(session.error ?? "Couldn't connect your GitHub account.");
        githubSession = session;
      }
      const response = await fetch(BUILD_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session: githubSession.session, planToken: proposal.token }) });
      const result = await response.json() as BuildFireResult & { error?: string };
      if (!response.ok || !result.runId || !result.statusToken) {
        if (response.status === 401) githubSession = null;
        throw new Error(result.error ?? "Couldn't start the build.");
      }
      onChange({ ...proposal, build: { runId: result.runId, branch: result.branch, statusToken: result.statusToken } });
    } catch (err) {
      setError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "Couldn't reach the server.");
    } finally { setWorking(false); }
  }

  return (
    <section aria-label={`Build plan: ${proposal.plan.title}`} className="mt-3 min-w-0 space-y-3 rounded-lg border border-line-strong bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="label-mono text-[10px] text-muted-foreground">Site improvement plan</span>
        {expired && !used && <span className="text-xs text-muted-foreground">Plan expired</span>}
      </div>
      <h3 className="font-semibold">{proposal.plan.title}</h3>
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">Specification & acceptance criteria</summary>
        <div className="mt-2 text-xs"><ChatMarkdown>{proposal.plan.spec}</ChatMarkdown></div>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">{proposal.plan.acceptance.map((item, index) => <li key={index}>{item}</li>)}</ul>
        <p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">{proposal.plan.paths.join(", ")}</p>
      </details>
      {proposal.issue ? (
        <p className="text-xs">Opened <a href={proposal.issue.url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">issue #{proposal.issue.number}</a> on GitHub.</p>
      ) : proposal.build ? (
        <BuildStatusCard build={proposal.build} savedRun={proposal.run} onRun={(run) => onChange({ ...proposal, run })} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setIssueOpen(true)} disabled={disabled || issueOpen} className="rounded-md border border-line-strong px-3 py-2 text-xs transition-colors hover:bg-surface-hover disabled:opacity-40">Open issue</button>
            <button type="button" onClick={() => void startBuild()} disabled={disabled || issueOpen} className="rounded-md bg-foreground px-3 py-2 text-xs text-background disabled:opacity-40">{working ? "Connecting to GitHub…" : "Start build"}</button>
          </div>
          <p className="text-[11px] text-muted-foreground">Choose one destination. Builds create a public pull request with your GitHub account as co-author.</p>
          {expired && <p className="text-xs text-muted-foreground">Ask for a fresh plan to continue.</p>}
          {issueOpen && <IssuePanel proposal={proposal} disabled={disabled} onClose={() => setIssueOpen(false)} onCreated={(issue) => onChange({ ...proposal, issue })} />}
        </>
      )}
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
    </section>
  );
}

function BuildStatusCard({ build, savedRun, onRun }: { build: BuildFireResult; savedRun?: BuildRun; onRun: (run: BuildRun) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const onRunRef = useRef(onRun);
  useEffect(() => { onRunRef.current = onRun; });

  useEffect(() => {
    const element = ref.current;
    if (!element || !STATUS_URL) return;
    let visible = false;
    let request: AbortController | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    async function poll() {
      if (!visible || document.visibilityState !== "visible" || request) return;
      const controller = new AbortController();
      request = controller;
      try {
        const url = new URL(STATUS_URL!);
        url.searchParams.set("runId", build.runId);
        const response = await fetch(url, { headers: { Authorization: `Bearer ${build.statusToken}` }, signal: controller.signal, cache: "no-store", referrerPolicy: "no-referrer" });
        const run = await response.json() as BuildRun & { error?: string };
        if (!response.ok || !run.phase) throw new Error(run.error ?? "Build status is unknown.");
        onRunRef.current(run);
        setError(null);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "Couldn't refresh the build. Showing the last known status.");
      } finally { request = null; }
    }
    const refresh = () => {
      if (timer) clearInterval(timer);
      timer = null;
      if (visible && document.visibilityState === "visible") { void poll(); timer = setInterval(() => void poll(), POLL_MS); }
      else request?.abort();
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; refresh(); });
    observer.observe(element);
    document.addEventListener("visibilitychange", refresh);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", refresh); if (timer) clearInterval(timer); request?.abort(); };
  }, [build.runId, build.statusToken]);

  return (
    <div ref={ref} className="space-y-2 border-t border-line pt-3 text-xs" aria-label="Build status" aria-live="polite">
      <p className="font-semibold">{savedRun ? phaseLabels[savedRun.phase] ?? "Status unknown" : "Status unknown · checking…"}</p>
      {savedRun?.reason && <p>{savedRun.reason}</p>}
      {savedRun?.progress && <p className="text-muted-foreground">{savedRun.progress}</p>}
      {savedRun?.pr && <a href={savedRun.pr.url} target="_blank" rel="noreferrer noopener" className="inline-block underline underline-offset-2">View pull request #{savedRun.pr.number}</a>}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-muted-foreground">
        <dt>CI</dt><dd><Signal signal={savedRun?.ci} /></dd>
        <dt>Preview</dt><dd><Signal signal={savedRun?.preview} /></dd>
        <dt>Claude review</dt><dd><Signal signal={savedRun?.review} /></dd>
      </dl>
      <p className="text-[10px] text-muted-foreground">Claude review is advisory. Status refreshes while this card is visible.</p>
      <details className="text-[10px] text-muted-foreground"><summary className="cursor-pointer">Build details</summary><p className="mt-1 break-all font-mono">{build.runId}</p></details>
      {error && <p role="status" className="text-red-500">{error}</p>}
    </div>
  );
}

function Signal({ signal }: { signal?: BuildSignal }) {
  if (!signal) return <>Unknown</>;
  return signal.url ? <a href={signal.url} target="_blank" rel="noreferrer noopener" className="break-words underline underline-offset-2">{signal.state}</a> : <>{signal.state}</>;
}

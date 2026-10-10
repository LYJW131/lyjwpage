"use client";

import { useEffect, useRef, useState } from "react";

import { ChatMarkdown } from "@/components/chat-markdown";
import { GithubConsent } from "@/components/github-consent";
import { IssuePanel } from "@/components/github-issue-panel";
import { buildReviewSummary } from "@/lib/build-review-summary";
import { createBuildStatusPoller, isBuildTerminal } from "@/lib/build-status-polling";
import type { ChatProposal } from "@/lib/chat-archive";
import { signInWithGithub } from "@/lib/github-sign-in";
import { cn } from "@/lib/utils";
import { workerUrl } from "@/lib/worker-url";
import { BUILD_PATH, BUILD_STATUS_PATH, planLanguage, type BuildFireResult, type BuildPhase, type BuildRun, type BuildSignal, type PlanLanguage } from "@shared/build-routine";

const BUILD_URL = workerUrl(process.env.NEXT_PUBLIC_BACKEND_URL, BUILD_PATH);
const STATUS_URL = workerUrl(process.env.NEXT_PUBLIC_BACKEND_URL, BUILD_STATUS_PATH);

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
  const [buildOpen, setBuildOpen] = useState(false);
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
      if (!BUILD_URL) throw new Error("Builds are offline right now.");
      const signIn = await signInWithGithub();
      const response = await fetch(BUILD_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...signIn, planToken: proposal.token }) });
      const result = await response.json() as BuildFireResult & { error?: string };
      if (!response.ok || !result.runId || !result.statusToken) throw new Error(result.error ?? "Couldn't start the build.");
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
            <button type="button" onClick={() => setIssueOpen(true)} disabled={disabled || issueOpen || buildOpen} className="rounded-md border border-line-strong px-3 py-2 text-xs transition-colors hover:bg-surface-hover disabled:opacity-40">Open issue</button>
            <button type="button" onClick={() => { setError(null); setBuildOpen(true); }} disabled={disabled || issueOpen || buildOpen} className="rounded-md bg-foreground px-3 py-2 text-xs text-background disabled:opacity-40">Start build</button>
          </div>
          <p className="text-[11px] text-muted-foreground">Choose one destination. Builds create a public pull request with your GitHub account as co-author.</p>
          {expired && <p className="text-xs text-muted-foreground">Ask for a fresh plan to continue.</p>}
          {issueOpen && <IssuePanel proposal={proposal} disabled={disabled} onClose={() => setIssueOpen(false)} onCreated={(issue) => onChange({ ...proposal, issue })} />}
          {buildOpen && <BuildPanel language={planLanguage(proposal.plan)} working={working} disabled={disabled} onClose={() => { setError(null); setBuildOpen(false); }} onStart={() => void startBuild()} />}
        </>
      )}
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
    </section>
  );
}

function BuildPanel({ language, working, disabled, onClose, onStart }: { language: PlanLanguage; working: boolean; disabled: boolean; onClose: () => void; onStart: () => void }) {
  const [agreed, setAgreed] = useState(false);

  return (
    <div className="mt-3 space-y-2 rounded-md border border-line-strong bg-surface p-3 text-xs text-muted-foreground">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">A build opens a public pull request with your GitHub account as co-author.</span>
        <button type="button" onClick={onClose} disabled={working} aria-label="Close build confirmation" className="shrink-0 hover:text-foreground">Close</button>
      </div>
      <GithubConsent action="build" language={language} checked={agreed} onChange={setAgreed} disabled={working || disabled} />
      <button type="button" onClick={() => { if (agreed) onStart(); }} disabled={working || disabled || !agreed} className="rounded bg-foreground px-3 py-2 text-background disabled:opacity-40">
        {working ? "Connecting to GitHub…" : "Sign in with GitHub & start build"}
      </button>
    </div>
  );
}

function BuildStatusCard({ build, savedRun, onRun }: { build: BuildFireResult; savedRun?: BuildRun; onRun: (run: BuildRun) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const onRunRef = useRef(onRun);
  const terminal = isBuildTerminal(savedRun?.phase);
  useEffect(() => { onRunRef.current = onRun; });

  useEffect(() => {
    const element = ref.current;
    if (!element || !STATUS_URL || terminal) return;
    let visible = false;
    const polling = createBuildStatusPoller({
      load: async (signal) => {
        const url = new URL(STATUS_URL!);
        url.searchParams.set("runId", build.runId);
        const response = await fetch(url, { headers: { Authorization: `Bearer ${build.statusToken}` }, signal, cache: "no-store", referrerPolicy: "no-referrer" });
        const run = await response.json() as BuildRun & { error?: string };
        if (!response.ok || !run.phase) throw new Error(run.error ?? "Build status is unknown.");
        return run;
      },
      onRun: (run) => {
        onRunRef.current(run);
        setError(null);
      },
      onError: (err) => setError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "Couldn't refresh the build. Showing the last known status."),
    });
    const refresh = () => { void polling.setVisible(visible && document.visibilityState === "visible"); };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; refresh(); });
    observer.observe(element);
    document.addEventListener("visibilitychange", refresh);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", refresh); polling.stop(); };
  }, [build.runId, build.statusToken, terminal]);

  return (
    <div ref={ref} className="space-y-2 border-t border-line pt-3 text-xs" aria-label="Build status" aria-live="polite">
      <p className="font-semibold">{savedRun ? phaseLabels[savedRun.phase] ?? "Status unknown" : "Status unknown · checking…"}</p>
      {savedRun && <BuildProgress run={savedRun} />}
      {savedRun?.reason && <p>{savedRun.reason}</p>}
      {savedRun?.pr && <a href={savedRun.pr.url} target="_blank" rel="noreferrer noopener" className="inline-block underline underline-offset-2">View pull request #{savedRun.pr.number}</a>}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-muted-foreground">
        <dt>CI</dt><dd><Signal signal={savedRun?.ci} /></dd>
        <dt>Preview</dt><dd><Signal signal={savedRun?.preview} /></dd>
        <dt>Claude review</dt><dd><Signal signal={savedRun?.review} label={buildReviewSummary(savedRun?.review?.state)} /></dd>
      </dl>
      <p className="text-[10px] text-muted-foreground">Claude review is advisory. {terminal ? "This build has finished; automatic refresh is off." : "Status refreshes while this card is visible."}</p>
      <details className="text-[10px] text-muted-foreground"><summary className="cursor-pointer">Build details</summary><p className="mt-1 break-all font-mono">{build.runId}</p></details>
      {error && <p role="status" className="text-red-500">{error}</p>}
    </div>
  );
}

const STEPS = ["Queued", "Building", "Uploaded", "PR"] as const;
const STEP_OF: Record<BuildPhase, number> = { triggered: 0, running: 1, uploaded: 2, validated: 2, blocked: 2, failed: 2, timeout: 1, pr_open: 3, merged: 3, closed: 3 };
const ACTIVE_PHASES: readonly BuildPhase[] = ["triggered", "running", "uploaded", "validated"];
const FAILED_PHASES: readonly BuildPhase[] = ["blocked", "failed", "timeout"];
// 按已跑过的构建粗估，只用来安抚等待，不参与超时判断（超时见 BUILD_TIMEOUT_MS）。
const TYPICAL_BUILD = "usually 5–15 min";
const PROGRESS_LOG = 4;

function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function BuildProgress({ run }: { run: BuildRun }) {
  const active = ACTIVE_PHASES.includes(run.phase);
  const failed = FAILED_PHASES.includes(run.phase);
  const current = STEP_OF[run.phase] ?? 0;
  const [now, setNow] = useState(() => Date.now());
  const [log, setLog] = useState<string[]>(() => run.progress ? [run.progress] : []);
  const [lastProgress, setLastProgress] = useState(run.progress);
  if (run.progress !== lastProgress) {
    setLastProgress(run.progress);
    if (run.progress) setLog((entries) => [...entries.filter((entry) => entry !== run.progress), run.progress!].slice(-PROGRESS_LOG));
  }

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  return (
    <div className="space-y-2">
      <ol className="flex items-center gap-1.5" aria-label="Build stages">
        {STEPS.map((step, index) => {
          const reached = index < current || (index === current && !active && !failed);
          const here = index === current;
          return (
            <li key={step} className={cn("flex items-center gap-1.5", index < STEPS.length - 1 && "flex-1")} aria-current={here ? "step" : undefined}>
              <span className={cn(
                "size-2 shrink-0 rounded-full border",
                reached ? "border-foreground bg-foreground" : "border-line-strong",
                here && active && "animate-pulse border-foreground bg-foreground/60",
                here && failed && "border-red-500 bg-red-500",
              )} />
              <span className={cn("shrink-0 text-[10px]", here || reached ? "text-foreground" : "text-muted-foreground")}>{step}</span>
              {index < STEPS.length - 1 && <span className={cn("h-px min-w-2 flex-1", index < current ? "bg-foreground" : "bg-line")} />}
            </li>
          );
        })}
      </ol>
      {active && <p className="font-mono text-[10px] tabular-nums text-muted-foreground">Running for {elapsed(now - run.createdAt)} · {TYPICAL_BUILD}</p>}
      {active && log.length > 0 && (
        <ul className="space-y-0.5 text-muted-foreground">
          {log.map((entry, index) => <li key={entry} className={cn("break-words", index === log.length - 1 && "text-foreground")}>{entry}</li>)}
        </ul>
      )}
    </div>
  );
}

function Signal({ signal, label = signal?.state }: { signal?: BuildSignal; label?: string }) {
  if (!signal) return <>Unknown</>;
  return signal.url ? <a href={signal.url} target="_blank" rel="noreferrer noopener" className="break-words underline underline-offset-2">{label}</a> : <>{label}</>;
}

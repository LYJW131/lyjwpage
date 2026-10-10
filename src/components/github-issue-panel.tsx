"use client";

import { useState } from "react";

import { GithubConsent } from "@/components/github-consent";
import { signInWithGithub } from "@/lib/github-sign-in";
import { workerUrl } from "@/lib/worker-url";
import { GITHUB_ISSUE_PATH, GITHUB_ISSUE_REPO, type GithubIssueResult } from "@shared/github-issue";
import type { BuildProposal } from "@shared/build-routine";

const ISSUE_URL = workerUrl(process.env.NEXT_PUBLIC_BACKEND_URL, GITHUB_ISSUE_PATH);

export function IssuePanel({ proposal, onClose, onCreated, disabled }: {
  proposal: BuildProposal;
  onClose: () => void;
  onCreated: (issue: GithubIssueResult) => void;
  disabled: boolean;
}) {
  const [working, setWorking] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (working || disabled || !agreed) return;
    setWorking(true);
    setError(null);
    try {
      if (!ISSUE_URL) throw new Error("Filing issues is offline right now.");
      const signIn = await signInWithGithub();
      const res = await fetch(ISSUE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...signIn, planToken: proposal.token }),
      });
      const data = await res.json().catch(() => null) as (GithubIssueResult & { error?: string }) | null;
      if (!res.ok || !data?.url) throw new Error(data?.error ?? "Couldn't open the issue. Try again.");
      onCreated({ url: data.url, number: data.number });
    } catch (err) {
      setError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "Couldn't reach the server.");
    } finally { setWorking(false); }
  }

  return (
    <div className="mt-3 space-y-2 rounded-md border border-line-strong bg-surface p-3 text-xs text-muted-foreground">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">The plan and acceptance criteria will be posted publicly to {GITHUB_ISSUE_REPO} under your GitHub account.</span>
        <button type="button" onClick={onClose} disabled={working} aria-label="Close issue confirmation" className="shrink-0 hover:text-foreground">Close</button>
      </div>
      <GithubConsent action="issue" checked={agreed} onChange={setAgreed} disabled={working || disabled} />
      {error && <p role="alert" className="text-red-500">{error}</p>}
      <button type="button" onClick={() => void submit()} disabled={working || disabled || !agreed} className="rounded bg-foreground px-3 py-2 text-background disabled:opacity-40">
        {working ? "Waiting for GitHub…" : "Sign in with GitHub & submit"}
      </button>
    </div>
  );
}

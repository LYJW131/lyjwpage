"use client";

import { useState } from "react";

import { GithubConsent } from "@/components/github-consent";
import { signInWithGithub } from "@/lib/github-sign-in";
import { workerUrl } from "@/lib/worker-url";
import { GITHUB_ISSUE_PATH, type GithubIssueResult } from "@shared/github-issue";
import { planLanguage, type BuildProposal } from "@shared/build-routine";

const ISSUE_URL = workerUrl(process.env.NEXT_PUBLIC_BACKEND_URL, GITHUB_ISSUE_PATH);

export function IssuePanel({ proposal, onClose, onCreated, disabled }: {
  proposal: BuildProposal;
  onClose: () => void;
  onCreated: (issue: GithubIssueResult) => void;
  disabled: boolean;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (working || disabled) return;
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

  return <GithubConsent action="issue" language={planLanguage(proposal.plan)} working={working} disabled={disabled} error={error} onAccept={() => void submit()} onCancel={onClose} />;
}

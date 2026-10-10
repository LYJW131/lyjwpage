"use client";

import { useId } from "react";

import { GITHUB_ISSUE_REPO } from "@shared/github-issue";

export function GithubConsent({ action, checked, onChange, disabled }: {
  action: "issue" | "build";
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
}) {
  const id = useId();
  const termsId = `${id}-terms`;
  const checkboxId = `${id}-checkbox`;

  return (
    <div className="min-w-0 space-y-2 rounded-md border border-line-strong bg-surface p-3 text-xs text-muted-foreground">
      <p className="font-semibold text-foreground">Before you connect GitHub</p>
      <ul id={termsId} className="list-disc space-y-1 break-words pl-4">
        <li><span className="text-foreground">Why:</span> GitHub sign-in confirms which GitHub account is making this request.</li>
        <li><span className="text-foreground">What happens:</span> GitHub gives this site only a one-time authorization code. Our server exchanges it for a short-lived token, uses it for this single action, then asks GitHub to revoke it right away. The token is never stored.</li>
        {action === "issue" ? (
          <li><span className="text-foreground">Issue:</span> a public issue containing the plan and acceptance criteria is created in {GITHUB_ISSUE_REPO} under your GitHub account.</li>
        ) : (
          <li><span className="text-foreground">Build:</span> only your GitHub username, user ID and display name are read, to create a GitHub noreply co-author that lists you as co-author on a public pull request.</li>
        )}
        <li><span className="text-foreground">Public:</span> the result is publicly visible on GitHub.</li>
        <li><span className="text-foreground">Control:</span> you can review or revoke this site&apos;s access at any time in GitHub <a href="https://github.com/settings/applications" target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-foreground">Settings → Applications</a>.</li>
      </ul>
      <label htmlFor={checkboxId} className="flex items-start gap-2 text-foreground">
        <input
          id={checkboxId}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
          aria-describedby={termsId}
          className="mt-0.5 shrink-0 accent-foreground"
        />
        <span className="min-w-0 break-words">I understand and agree to connect my GitHub account for this action.</span>
      </label>
    </div>
  );
}

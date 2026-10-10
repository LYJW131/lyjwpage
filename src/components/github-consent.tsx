"use client";

import type { ReactNode } from "react";

import type { PlanLanguage } from "@shared/build-routine";
import { GITHUB_ISSUE_REPO } from "@shared/github-issue";

const SETTINGS_URL = "https://github.com/settings/applications";
const settingsLink = (label: string) => <a href={SETTINGS_URL} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-foreground">{label}</a>;

// 站主要求 GitHub 授权说明跟随计划语言（与 issue、PR 文案同一套判断），是「界面文案英文」的例外；三种语言的条目须同步。
type Term = [string, ReactNode];
type GithubConsentCopy = { lang: string; colon: string; title: string; intro: Record<"issue" | "build", string>; why: Term; what: Term; issue: Term; build: Term; public: Term; control: Term; accept: string; working: string; cancel: string };
const COPY: Record<PlanLanguage, GithubConsentCopy> = {
  en: {
    lang: "en",
    colon: ": ",
    title: "Before you connect GitHub",
    intro: { issue: "Signing in with GitHub to open this issue means:", build: "Signing in with GitHub to start this build means:" },
    why: ["Why", "GitHub sign-in confirms which GitHub account is making this request."],
    what: ["What happens", "GitHub gives this site only a one-time authorization code. Our server exchanges it for a short-lived token, uses it for this single action, then asks GitHub to revoke it right away. The token is never stored."],
    issue: ["Issue", <>a public issue containing the plan and acceptance criteria is created in {GITHUB_ISSUE_REPO} under your GitHub account.</>],
    build: ["Build", "only your GitHub username, user ID and display name are read, to create a GitHub noreply co-author that lists you as co-author on a public pull request."],
    public: ["Public", "the result is publicly visible on GitHub."],
    control: ["Control", <>you can review or revoke this site&apos;s access at any time in GitHub {settingsLink("Settings → Applications")}.</>],
    accept: "Accept & sign in with GitHub",
    working: "Waiting for GitHub…",
    cancel: "Cancel",
  },
  zh: {
    lang: "zh-CN",
    colon: "：",
    title: "连接 GitHub 之前",
    intro: { issue: "用 GitHub 登录来提交这个 issue，意味着：", build: "用 GitHub 登录来发起这次构建，意味着：" },
    why: ["用途", "GitHub 登录用来确认由哪个 GitHub 账号发起这次请求。"],
    what: ["过程", "GitHub 只把一次性授权码交给本站。本站服务器把它换成短期 token，只用于这一次操作，随后立即请 GitHub 撤销。token 不会被保存。"],
    issue: ["Issue", <>会以你的 GitHub 账号在 {GITHUB_ISSUE_REPO} 公开创建一个 issue，内容是计划和验收标准。</>],
    build: ["构建", "只读取你的 GitHub 用户名、用户 ID 和显示名，用来生成 GitHub noreply co-author，在公开的 pull request 中把你列为 co-author。"],
    public: ["公开", "结果在 GitHub 上公开可见。"],
    control: ["控制", <>你可以随时在 GitHub 的 {settingsLink("Settings → Applications")} 中查看或撤销本站的授权。</>],
    accept: "接受并用 GitHub 登录",
    working: "正在等待 GitHub…",
    cancel: "取消",
  },
  ja: {
    lang: "ja",
    colon: "：",
    title: "GitHub に接続する前に",
    intro: { issue: "この issue を作成するために GitHub でログインすると：", build: "このビルドを始めるために GitHub でログインすると：" },
    why: ["目的", "GitHub ログインで、どの GitHub アカウントからのリクエストかを確認します。"],
    what: ["流れ", "GitHub が本サイトに渡すのは一度きりの認可コードだけです。本サイトのサーバーはそれを短期間有効なトークンに交換し、この操作だけに使ったあと、すぐに GitHub へ失効を依頼します。トークンは保存されません。"],
    issue: ["Issue", <>あなたの GitHub アカウントで {GITHUB_ISSUE_REPO} に、計画と受け入れ基準を含む公開の issue が作成されます。</>],
    build: ["ビルド", "GitHub のユーザー名、ユーザー ID、表示名だけを読み取り、GitHub noreply の co-author を作成して、公開の pull request にあなたを co-author として記載します。"],
    public: ["公開", "結果は GitHub 上で公開されます。"],
    control: ["管理", <>本サイトのアクセス権は、GitHub の {settingsLink("Settings → Applications")} でいつでも確認・取り消しできます。</>],
    accept: "同意して GitHub でログイン",
    working: "GitHub を待っています…",
    cancel: "キャンセル",
  },
};

export function GithubConsent({ action, language, working, disabled, error, onAccept, onCancel }: {
  action: "issue" | "build";
  language: PlanLanguage;
  working: boolean;
  disabled: boolean;
  error: string | null;
  onAccept: () => void;
  onCancel: () => void;
}) {
  const copy = COPY[language];
  const terms = [copy.why, copy.what, action === "issue" ? copy.issue : copy.build, copy.public, copy.control];

  return (
    <div role="group" aria-label={copy.title} lang={copy.lang} className="mt-3 border-t border-line pt-3 text-sm leading-relaxed text-foreground">
      <div className="label-mono mb-1.5 text-[10px] text-muted-foreground">{copy.title}</div>
      <p>{copy.intro[action]}</p>
      <ul className="mt-1.5 list-disc space-y-1 break-words pl-5 text-xs text-muted-foreground">
        {terms.map(([label, body]) => (
          <li key={label}><span className="font-medium text-foreground">{label}{copy.colon}</span>{body}</li>
        ))}
      </ul>
      {error && <p role="alert" lang="en" className="mt-2 text-xs text-red-500">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onAccept} disabled={working || disabled} className="rounded-md bg-foreground px-3 py-1.5 text-xs text-background disabled:opacity-40">{working ? copy.working : copy.accept}</button>
        <button type="button" onClick={onCancel} disabled={working} className="rounded-md border border-line-strong px-3 py-1.5 text-xs transition-colors hover:bg-surface-hover disabled:opacity-40">{copy.cancel}</button>
      </div>
    </div>
  );
}

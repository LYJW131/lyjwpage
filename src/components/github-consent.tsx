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
    why: ["Purpose", "GitHub sign-in confirms which account is making this request."],
    what: ["Process", "GitHub grants this site only a one-time authorization code. Our server exchanges it for a short-lived token, uses it strictly for this single action, and immediately requests revocation. The token is never stored."],
    issue: ["Issue", <>A public issue containing the plan and acceptance criteria will be created in {GITHUB_ISSUE_REPO} under your GitHub account.</>],
    build: ["Build", "Reads only your GitHub username, user ID, and display name to create a GitHub noreply address that credits you as a co-author on a public pull request."],
    public: ["Visibility", "The resulting issue or pull request is publicly visible on GitHub."],
    control: ["Control", <>You can review or revoke this site&apos;s access at any time in GitHub {settingsLink("Settings → Applications")}.</>],
    accept: "Accept & sign in with GitHub",
    working: "Waiting for GitHub…",
    cancel: "Cancel",
  },
  zh: {
    lang: "zh-CN",
    colon: "：",
    title: "连接 GitHub 之前",
    intro: { issue: "使用 GitHub 登录以提交该 Issue，意味着：", build: "使用 GitHub 登录以发起本次构建，意味着：" },
    why: ["用途", "通过 GitHub 登录确认发起本次操作的账号身份。"],
    what: ["流程", "GitHub 仅向本站颁发一次性授权码。服务器将其兑换为短期 Token，仅用于本次单次操作，随后立即请求 GitHub 撤销。本站绝不保存 Token。"],
    issue: ["Issue", <>将以你的 GitHub 账号在 {GITHUB_ISSUE_REPO} 公开创建包含计划与验收标准的 Issue。</>],
    build: ["构建", "仅读取你的 GitHub 用户名、用户 ID 及显示名称，用于生成 GitHub noreply 邮箱，在公开的 Pull Request 中将你署名为联合提交者（co-author）。"],
    public: ["公开范围", "生成的所有内容在 GitHub 上均为公开可见。"],
    control: ["权限控制", <>你可随时在 GitHub 的 {settingsLink("Settings → Applications")} 中查看或撤销本站的访问权限。</>],
    accept: "同意并使用 GitHub 登录",
    working: "正在等待 GitHub 响应…",
    cancel: "取消",
  },
  ja: {
    lang: "ja",
    colon: "：",
    title: "GitHub に接続する前に",
    intro: { issue: "GitHub ログインを行ってこの issue を作成するにあたり、以下の点をご確認ください：", build: "GitHub ログインを行ってこのビルドを開始するにあたり、以下の点をご確認ください：" },
    why: ["目的", "どの GitHub アカウントからのリクエストであるかを確認します。"],
    what: ["処理の流れ", "GitHub から本サイトに渡されるのは一度限りの認可コードのみです。サーバーがそれを短期トークンと交換し、今回の操作にのみ使用した後、直ちに GitHub へ失効をリクエストします。トークンは一切保存されません。"],
    issue: ["Issue", <>あなたの GitHub アカウント名義で {GITHUB_ISSUE_REPO} に、計画と受け入れ基準を含む公開の issue が作成されます。</>],
    build: ["ビルド", "GitHub のユーザー名・ユーザー ID・表示名のみを読み取り、GitHub noreply メールアドレスを生成して、公開 pull request の共同作成者（co-author）として記載します。"],
    public: ["公開範囲", "生成された issue または pull request は GitHub 上で一般公開されます。"],
    control: ["権限の管理", <>本サイトへのアクセス権限は、GitHub の {settingsLink("Settings → Applications")} でいつでも確認・取り消しが可能です。</>],
    accept: "同意して GitHub でログイン",
    working: "GitHub に接続中…",
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

export { BUILD_PATH, BUILD_STATUS_PATH, BUILD_UPLOAD_PATH, BUILD_PROGRESS_PATH, BUILD_SCREENSHOT_PATH, BUILD_WEBHOOK_PATH } from "./ai-paths";

export const BUILD_REPO = "LYJW131/lyjwpage";

// A short, bounded planning session limits paid Opus work independently of ordinary chat quotas.
export const BUILD_DESIGN_LIMITS = { ttlMs: 30 * 60_000, maxTurns: 12, windowMs: 60 * 60_000, everyone: 20 } as const;
export const BUILD_TOKEN_MAX_CHARS = 64_000;
export const BUILD_PLAN_TTL_MS = 60 * 60_000;
export const BUILD_TIMEOUT_MS = 45 * 60_000;
export const BUILD_STATUS_TTL_MS = 30 * 24 * 60 * 60_000;
export const BUILD_RECONCILE_MS = 60_000;
export const BUILD_PLAN_LIMITS = { titleChars: 100, specChars: 6000, acceptanceItems: 8, acceptanceChars: 300, paths: 30 } as const;
export const BUILD_QUOTA = { windowMs: 60 * 60_000, fire: { account: 3, everyone: 10 } } as const;
// outsidePlanFiles：计划没列到、但为了契约或测试必须一起改的文件，放行这么多个（Markdown 文档不计），PR 正文的重点审查一节列出。
export const BUILD_UPLOAD_LIMITS = { files: 80, fileBytes: 512 * 1024, totalBytes: 2 * 1024 * 1024, requestBytes: 3 * 1024 * 1024, messageChars: 2000, outsidePlanFiles: 5 } as const;
// 截图存进站点 R2 图片桶、永久以 /img/<objectKey> 公开，每次构建的张数和单张字节都要有上限。
export const BUILD_SCREENSHOT_LIMITS = { count: 6, bytes: 2 * 1024 * 1024, captionChars: 80 } as const;

export type BuildPlan = { title: string; spec: string; acceptance: string[]; paths: string[] };
export type BuildProposal = { plan: BuildPlan; token: string; expiresAt: number };
export type BuildFireResult = { runId: string; branch: string; statusToken: string; run?: BuildRun };
export const BUILD_PHASES = ["triggered", "running", "uploaded", "validated", "blocked", "pr_open", "merged", "closed", "timeout", "failed"] as const;
export type BuildPhase = (typeof BUILD_PHASES)[number];
export const BUILD_ACTIVE_PHASES: readonly BuildPhase[] = ["triggered", "running", "uploaded", "validated"];
export const BUILD_FAILED_PHASES: readonly BuildPhase[] = ["blocked", "failed", "timeout"];
export const BUILD_CLOSED_PHASES: readonly BuildPhase[] = ["merged", "closed"];
export type BuildSignal = { state: string; url?: string; updatedAt: number };
export type BuildRun = {
  runId: string;
  branch: string;
  phase: BuildPhase;
  createdAt: number;
  updatedAt: number;
  reason?: string;
  progress?: string;
  pr?: { number: number; url: string; headSha: string; draft?: boolean };
  ci?: BuildSignal;
  preview?: BuildSignal;
  review?: BuildSignal;
  // Vercel 预览的公开分享链接：preview.url 在部署成功后换成 url；expiresAt 为 epoch 毫秒。
  previewShare?: { deploymentId: string; url: string; expiresAt: number };
  reconciledAt?: number;
  githubUpdatedAt?: number;
};
export type BuildScreenshot = { objectKey: string; caption: string };
export type BuildUpload = { baseSha: string; message: string; files: { path: string; content: string; mode: "100644" | "100755" }[]; deletions: string[] };

export function newRunId(): string { return crypto.randomUUID().replaceAll("-", ""); }
export function branchForRun(runId: string): string { return `claude/build-${runId}`; }
export function runIdFromBranch(ref: string): string | null {
  const match = /^(?:refs\/heads\/)?claude\/build-([a-f0-9]{32})$/.exec(ref);
  return match?.[1] ?? null;
}
export type PlanLanguage = "zh" | "ja" | "en";

// 计划正文跟随对话语言，issue 与 PR 的固定文案跟随计划：中日文按字数比拉丁字母更「重」，路径、标识符里的
// 拉丁字母不该把中文计划判成英文，英文计划里引用的几个中文歌名也不该把它判成中文；假名占比高才算日文。
export function planLanguage(plan: Pick<BuildPlan, "title" | "spec" | "acceptance">): PlanLanguage {
  return textLanguage(`${plan.title}\n${plan.spec}\n${plan.acceptance.join("\n")}`);
}

// 访客看到的说明跟标题走：规格常是英文技术说明，标题按规划者的约定用访客的语言。
export function visitorLanguage(plan: Pick<BuildPlan, "title">): PlanLanguage {
  return textLanguage(plan.title);
}

export function textLanguage(text: string): PlanLanguage {
  const kana = text.match(/[\u3040-\u30ff]/g)?.length ?? 0;
  const han = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  if ((kana + han) * 3 < latin || kana + han === 0) return "en";
  return kana > (kana + han) * 0.2 ? "ja" : "zh";
}

export const PLAN_LABELS = {
  en: {
    acceptance: "Acceptance criteria",
    paths: "Planned paths",
    review: "Review closely",
    reasons: { outside: "outside the plan", contract: "shared contract", auth: "build or auth code", prompt: "chat prompts", docs: "documentation outside docs/" },
    requestedBy: (account: string) => `Requested by @${account}.`,
    buildRun: (runId: string) => `Build run: \`${runId}\`. Claude review is advisory; it does not authorize merging.`,
    issueFooter: "_Filed from the [homepage chat](https://lyjw.me)._",
    planReady: "Here is the plan for your review.",
    askReady: "Pick your answers below.",
    handoff: "Good idea. I'll bring in the planner to work it out with you.",
    screenshots: "Screenshots",
    screenshotsNote: "Captured by the build routine on its local dev server before upload; the Vercel preview is the deployed result.",
  },
  zh: {
    acceptance: "验收标准",
    paths: "计划路径",
    review: "重点审查",
    reasons: { outside: "计划外", contract: "共享契约", auth: "构建或授权代码", prompt: "对话提示词", docs: "docs/ 之外的文档" },
    requestedBy: (account: string) => `由 @${account} 发起。`,
    buildRun: (runId: string) => `构建编号：\`${runId}\`。Claude 的审查仅供参考，不代表可以合并。`,
    issueFooter: "_提交自[首页对话](https://lyjw.me)。_",
    planReady: "方案如下，请过目。",
    askReady: "请在下面选一下。",
    handoff: "好主意，我请规划者来和你一起把它想清楚。",
    screenshots: "截图",
    screenshotsNote: "由构建 routine 在上传前于本地开发服务器截取；部署后的效果以 Vercel 预览为准。",
  },
  ja: {
    acceptance: "受け入れ基準",
    paths: "変更予定のパス",
    review: "重点レビュー",
    reasons: { outside: "計画外", contract: "共有コントラクト", auth: "ビルド・認証コード", prompt: "チャットのプロンプト", docs: "docs/ 以外のドキュメント" },
    requestedBy: (account: string) => `@${account} さんのリクエストです。`,
    buildRun: (runId: string) => `ビルド ID：\`${runId}\`。Claude のレビューは参考情報で、マージを承認するものではありません。`,
    issueFooter: "_[ホームページのチャット](https://lyjw.me)から作成されました。_",
    planReady: "プランを用意しました。ご確認ください。",
    askReady: "下から選んでください。",
    handoff: "いいですね。プランナーに引き継いで、一緒に詰めていきます。",
    screenshots: "スクリーンショット",
    screenshotsNote: "ビルド routine がアップロード前にローカルの開発サーバーで撮影したものです。デプロイ後の表示は Vercel のプレビューで確認してください。",
  },
} as const satisfies Record<PlanLanguage, unknown>;

export function buildIssueBody(plan: BuildPlan): string {
  const labels = PLAN_LABELS[planLanguage(plan)];
  return `${plan.spec}\n\n## ${labels.acceptance}\n${plan.acceptance.map((item) => `- [ ] ${item}`).join("\n")}\n\n## ${labels.paths}\n${plan.paths.map((path) => `- \`${path}\``).join("\n")}`;
}

export function buildIssueUrl(plan: BuildPlan): string {
  const labels = PLAN_LABELS[planLanguage(plan)];
  const body = `${buildIssueBody(plan)}\n\n---\n${labels.issueFooter}`;
  const params = new URLSearchParams({ title: plan.title, body });
  return `https://github.com/${BUILD_REPO}/issues/new?${params.toString()}`;
}


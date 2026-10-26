const UI_PATHS = [/^src\/components\//, /^src\/app\/(?!api\/)/, /\.css$/, /^public\/(?!.*\.(?:txt|md)$)/i, /^docs\/explainer\/v2\//];
// public 下的 .txt / .md 是给机器读的纯文本（llms.txt），不改界面。
const DOC_PATHS = [/\.md$/i, /^\.claude\//, /^docs\//, /^public\/.*\.txt$/i];
// 会话或服务端照着执行、或决定哪些命令与响应头生效的文件：落在 .claude、docs、public 下也按逻辑档收门槛。
const EXEC_PATHS = [
  /^\.claude\/settings[^/]*\.json$/,
  /^\.claude\/launch\.json$/,
  /^\.claude\/hooks\//,
  /^\.claude\/skills\/[^/]+\/feature-map\.json$/,
  /^\.claude\/.*\.(?:[cm]?[jt]sx?|py|sh)$/,
  /^docs\/(?:.*\/)?(?:package\.json|pnpm-lock\.yaml)$/,
  /^docs\/(?!explainer\/v2\/).*\.(?:[cm]?[jt]sx?|py|sh)$/,
  /^public\/(?:.*\/)?(?:_headers|_redirects)$/,
  /^public\/.*\.(?:[cm]?[jt]sx?|html?|xht(?:ml)?|svg|xml)$/,
];

// 改动大小与要不要叫 Opus 判定员由写 PR 的线程判断：大改贴这个标签；作者不是 lyjw 的账号时总要判定
export const JUDGE_LABEL = "needs-judge";
export const judgeAsked = (pull: { labels?: { name: string }[] }) => pull.labels?.some((label) => label.name === JUDGE_LABEL) ?? false;

// commentOnly：经 docs:comment-only 证明只改了注释的文件。lyjw 的账号开的 PR 里按文档档算，不因路径进界面档或逻辑档。
export function tierOf(files: string[], { trustedAuthor, judgeAsked = false, commentOnly = [] }: { trustedAuthor: boolean; judgeAsked?: boolean; commentOnly?: string[] }) {
  const exec = (file: string) => EXEC_PATHS.some((re) => re.test(file));
  const notes = (file: string) => trustedAuthor && commentOnly.includes(file);
  const ui = files.filter((file) => !exec(file) && !notes(file) && UI_PATHS.some((re) => re.test(file)));
  const logic = files.filter((file) => !ui.includes(file) && !notes(file) && (exec(file) || !trustedAuthor || !DOC_PATHS.some((re) => re.test(file))));
  const name = ui.length > 0 && logic.length > 0 ? "ui+logic" : ui.length > 0 ? "ui" : logic.length > 0 ? "logic" : "docs";
  const hints: string[] = [];
  if (name === "docs") hints.push("只改文档与 skill：CI 绿、线程解决了就合，不要回执、不等机器评审");
  if (ui.length > 0) hints.push("碰到界面：回执要 live-ui-verified，合并前要 lyjw 看图点头（ready 不含这一项）；lyjw 明确要求的小改动除外");
  if (logic.length > 0) hints.push("改了逻辑：线程判断改动大小，大改贴 needs-judge 标签叫 Opus 判定员并等机器评审，小改不写");
  if (!trustedAuthor) hints.push("PR 作者不是 lyjw 的账号：整个 PR 按逻辑档走回执与判定，--need、--no-judge 不放行");
  const need = ui.length > 0 ? "live-ui-verified" : logic.length > 0 || !trustedAuthor ? "unit-test-verified" : null;
  return {
    name,
    ui,
    logic,
    need,
    judge: !trustedAuthor || (judgeAsked && need !== null),
    hint: hints.join("；"),
  };
}

// verify-action.ts 与 verify-receipt.ts 连同它们 import 的分档、构建覆盖、预览地址与撤回证明都算验证员本身，拿 API 钥匙的 pi 验证员（verify-agent.ts、verify-agent/ 与它的 action）也算，贴 verifier-changed 标签的代码、查回执的合并钩子（连同它 import 的合并信息生成），以及判定员照着读的根 AGENTS.md、REVIEW.md 也算：
// PR 改了它们，回执与标记就出自被改过的那份；lyjw 定了不堵，只标出来。
const VERIFIER_PATHS = [
  /^\.github\/workflows\/verify\.yml$/,
  /^\.github\/actions\/verify-tools\//,
  /^\.github\/actions\/verify-agent\//,
  /^scripts\/verify-agent(?:\.ts|\.test\.ts|\/)/,
  /^scripts\/verify-action(?:\.ts|\/)/,
  /^scripts\/verify-receipt(?:\.ts|\/)/,
  /^scripts\/comment-only(?:-check\.ts|\/)/,
  /^scripts\/pr-gate(?:\.ts|\/)/,
  /^scripts\/preview-worker-name\.ts$/,
  /^scripts\/revert-proof\.ts$/,
  /^scripts\/build-watch-paths\.ts$/,
  /^scripts\/rule-drift\.ts$/,
  /^scripts\/strip-html\.ts$/,
  /^scripts\/pr-tier\.ts$/,
  /^\.github\/workflows\/pr-tier-label\.yml$/,
  /^scripts\/guard-merge-method\.ts$/,
  /^scripts\/merge-message\.ts$/,
  /^shared\/commit-authors\.ts$/,
  /^AGENTS\.md$/,
  /^REVIEW\.md$/,
];

export const verifierFiles = (files: string[]) => files.filter((file) => VERIFIER_PATHS.some((re) => re.test(file)));

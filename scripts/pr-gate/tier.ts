const UI_PATHS = [/^src\/components\//, /^src\/app\/(?!api\/)/, /\.css$/, /^public\//, /^docs\/explainer\/v2\//];
const DOC_PATHS = [/\.md$/i, /^\.claude\//, /^docs\//];
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

export function tierOf(files: string[], { trustedAuthor }: { trustedAuthor: boolean }) {
  const exec = (file: string) => EXEC_PATHS.some((re) => re.test(file));
  const ui = files.filter((file) => !exec(file) && UI_PATHS.some((re) => re.test(file)));
  const logic = files.filter((file) => !ui.includes(file) && (exec(file) || !trustedAuthor || !DOC_PATHS.some((re) => re.test(file))));
  const name = ui.length > 0 && logic.length > 0 ? "ui+logic" : ui.length > 0 ? "ui" : logic.length > 0 ? "logic" : "docs";
  const hints: string[] = [];
  if (name === "docs") hints.push("只改文档与 skill：CI 绿、线程解决了就合，不要回执、不等机器评审");
  if (ui.length > 0) hints.push("碰到界面：回执要 live-ui-verified，合并前要 lyjw 看图点头（ready 不含这一项）；lyjw 明确要求的小改动除外");
  if (logic.length > 0) hints.push("改了逻辑：默认按大改算，等机器评审与判定；主线程判为小改动时加 --no-judge");
  if (!trustedAuthor) hints.push("PR 作者不是 lyjw 的账号：整个 PR 按逻辑档走回执与判定，--need、--no-judge 不放行");
  return {
    name,
    ui,
    logic,
    need: ui.length > 0 ? "live-ui-verified" : logic.length > 0 || !trustedAuthor ? "unit-test-verified" : null,
    judge: logic.length > 0 || !trustedAuthor,
    hint: hints.join("；"),
  };
}

// verify-action.ts 与 verify-receipt.ts 连同它们 import 的分档、构建覆盖与预览地址都算验证员本身，贴 verifier-changed 标签的代码也算：
// PR 改了它们，回执与标记就出自被改过的那份；lyjw 定了不堵，只标出来。
const VERIFIER_PATHS = [
  /^\.github\/workflows\/verify\.yml$/,
  /^scripts\/verify-action(?:\.ts|\/)/,
  /^scripts\/verify-receipt\.ts$/,
  /^scripts\/pr-gate(?:\.ts|\/)/,
  /^scripts\/preview-worker-name\.ts$/,
  /^scripts\/build-watch-paths\.ts$/,
  /^scripts\/rule-drift\.ts$/,
  /^scripts\/strip-html\.ts$/,
  /^shared\/sha256\.ts$/,
  /^scripts\/pr-tier\.ts$/,
  /^\.github\/workflows\/pr-tier-label\.yml$/,
];

export const verifierFiles = (files: string[]) => files.filter((file) => VERIFIER_PATHS.some((re) => re.test(file)));

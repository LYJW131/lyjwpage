const UI_PATHS = [/^src\/components\//, /^src\/app\/(?!api\/)/, /\.css$/, /^public\//, /^docs\/explainer\/v2\//];
const DOC_PATHS = [/\.md$/i, /^\.claude\/(?!.*\.(?:[cm]?[jt]sx?|py|sh)$)/, /^docs\//];

export function tierOf(files: string[]) {
  const ui = files.filter((file) => UI_PATHS.some((re) => re.test(file)));
  const logic = files.filter((file) => !ui.includes(file) && !DOC_PATHS.some((re) => re.test(file)));
  const name = ui.length > 0 && logic.length > 0 ? "ui+logic" : ui.length > 0 ? "ui" : logic.length > 0 ? "logic" : "docs";
  const hints: string[] = [];
  if (name === "docs") hints.push("只改文档与 skill：CI 绿、线程解决了就合，不要回执、不等机器评审");
  if (ui.length > 0) hints.push("碰到界面：回执要 live-ui-verified，合并前要 lyjw 看图点头（ready 不含这一项）；lyjw 明确要求的小改动除外");
  if (logic.length > 0) hints.push("改了逻辑：默认按大改算，等机器评审与判定；主线程判为小改动时加 --no-judge");
  return {
    name,
    ui,
    logic,
    need: ui.length > 0 ? "live-ui-verified" : logic.length > 0 ? "unit-test-verified" : null,
    judge: logic.length > 0,
    hint: hints.join("；"),
  };
}

// 软规则写在这些文件里，CI 拦不住；分支开工后 main 上改了它们，合并前要拿 PR 的改动对一遍新规则。
const RULE_PATHS = [/(^|\/)AGENTS\.md$/, /^DESIGN\.md$/, /^HUMAN\.md$/, /^\.claude\/skills\/.*\.md$/];

type Get = { get<T>(path: string): Promise<T> };
type PrCommit = { sha: string; parents?: { sha: string }[] };

export function isRulePath(path: string) {
  return RULE_PATHS.some((pattern) => pattern.test(path));
}

export async function ruleDrift(gh: Get, commits: PrCommit[], base: string) {
  const since = commits[0]?.parents?.[0]?.sha ?? null;
  if (!since) return { since, files: [], error: "读不到分支起点" };
  try {
    const compare = await gh.get<{ files?: { filename: string }[] }>(`compare/${since}...${base}`);
    return { since, files: (compare.files ?? []).map((file) => file.filename).filter(isRulePath), error: null };
  } catch (error) {
    return { since, files: [], error: (error as Error).message };
  }
}

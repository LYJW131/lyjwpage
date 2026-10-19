// 软规则写在这些文件里，CI 拦不住；分支开工后 main 上改了它们，合并前要拿 PR 的改动对一遍新规则。
const RULE_PATHS = [/(^|\/)AGENTS\.md$/, /^DESIGN\.md$/, /^HUMAN\.md$/, /^REVIEW\.md$/, /^\.claude\/skills\/.*\.md$/];
const COMPARE_FILE_LIMIT = 300;

type Get = { get<T>(path: string): Promise<T> };
type PrCommit = { sha: string; parents?: { sha: string }[] };

export function isRulePath(path: string) {
  return RULE_PATHS.some((pattern) => pattern.test(path));
}

export async function ruleDrift(gh: Get, commits: PrCommit[], base: string) {
  const since = commits[0]?.parents?.[0]?.sha ?? null;
  if (!since) return { since, files: [], error: "读不到分支起点" };
  try {
    const compare = await gh.get<{ files?: { filename: string; previous_filename?: string }[] }>(`compare/${since}...${base}`);
    const changed = compare.files ?? [];
    const files = changed.flatMap((file) => [file.filename, file.previous_filename ?? []].flat()).filter(isRulePath);
    // GitHub compare 最多返回 COMPARE_FILE_LIMIT 个文件，到了上限说明列表可能不全。
    const error = changed.length >= COMPARE_FILE_LIMIT ? `main 上改动超过 ${COMPARE_FILE_LIMIT} 个文件，列表可能不全，用 git diff 自己看` : null;
    return { since, files, error };
  } catch (error) {
    return { since, files: [], error: (error as Error).message };
  }
}

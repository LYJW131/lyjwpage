export function buildReviewSummary(body: string | undefined): string {
  const conclusion = body
    ?.replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^#{1,6}\s+/, "").replace(/[*_`]/g, "").trim())
    .find((line) => line && !/^code review$/i.test(line));
  if (!conclusion) return "Unknown";
  if (/^no issues(?: found)?(?:[.!]|$)/i.test(conclusion)) return "No issues";
  if (/^(?:found [1-9]\d* (?:issues?|bugs?)|issues? found)(?:[.!:]|$)/i.test(conclusion)) return "Issues found";
  return "Unknown";
}

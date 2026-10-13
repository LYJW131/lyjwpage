import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const TRAILER = /^co-authored-by:\s*.+<[^>]+>\s*$/i;

export function prCoAuthors(pr) {
  const prAuthor = pr.author?.login?.toLowerCase() ?? null;
  const seen = new Set();
  const trailers = [];
  for (const commit of pr.commits ?? []) {
    for (const author of commit.authors ?? []) {
      const name = author.name?.trim();
      const email = author.email?.trim();
      if (!name || !email) continue;
      if (prAuthor && author.login?.toLowerCase() === prAuthor) continue;
      const key = `${name}\n${email}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      trailers.push(`Co-Authored-By: ${name} <${email}>`);
    }
  }
  return trailers;
}

// 尾注必须是正文最后一段：git 与 GitHub 只认末段的 Co-Authored-By，站点的提交作者也来自 GitHub 的识别。
export function withCoAuthors(body, trailers) {
  const lines = (body ?? "").replace(/\r\n/g, "\n").split("\n");
  while (lines.length && (!lines.at(-1).trim() || TRAILER.test(lines.at(-1).trim()))) lines.pop();
  const text = lines.join("\n");
  if (!trailers.length) return text;
  return text ? `${text}\n\n${trailers.join("\n")}` : trailers.join("\n");
}

function gh(args, input) {
  return execFileSync("gh", args, { encoding: "utf8", input, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "inherit"] });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [number, mode] = process.argv.slice(2);
  if (!/^\d+$/.test(number ?? "") || (mode && mode !== "--merge")) {
    console.error("用法：node scripts/pr-coauthors.mjs <PR 号> [--merge]");
    process.exit(2);
  }
  const pr = JSON.parse(gh(["pr", "view", number, "--json", "title,body,author,commits"]));
  const body = withCoAuthors(pr.body, prCoAuthors(pr));
  if (body !== (pr.body ?? "").replace(/\r\n/g, "\n")) {
    gh(["pr", "edit", number, "--body-file", "-"], body);
    console.log(`#${number} 描述末尾的协作者已更新`);
  }
  if (mode === "--merge") {
    gh(["pr", "merge", number, "--merge", "--subject", `${pr.title} (#${number})`, "--body-file", "-"], body);
    console.log(`#${number} 已合并`);
  }
}

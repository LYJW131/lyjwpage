import { z } from "zod";
import type { Finding } from "./review-body.js";

const finding = z.object({
  kind: z.enum(["bug", "security"]),
  severity: z.enum(["high", "medium", "low"]),
  file: z.string().min(1).max(240),
  line: z.number().int().positive(),
  title: z.string().min(1).max(160),
  detail: z.string().min(1).max(1200),
});

const review = z.object({ findings: z.array(finding).max(12) });

// 评审员最后一条消息应当只有一个 JSON 对象；模型偶尔包上代码块或前置一句话，取最后一个能解析的对象。
export function parseFindings(text: string): Finding[] {
  const starts = [...text.matchAll(/\{\s*"findings"/g)].map((m) => m.index ?? 0).reverse();
  let lastError: unknown = new Error("no findings object in reply");
  for (const start of starts) {
    for (let end = text.lastIndexOf("}"); end > start; end = text.lastIndexOf("}", end - 1)) {
      try {
        return review.parse(JSON.parse(text.slice(start, end + 1))).findings;
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw lastError;
}

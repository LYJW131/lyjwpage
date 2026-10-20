import type { ChatAnswer } from "@/lib/chat-archive";

// 空 question 是不属于任何问题的补充说明。
export function askAnswerText(answers: ChatAnswer[]): string {
  return answers.map(({ question, answer }) => (question ? `${question} ${answer}` : `Additional note: ${answer}`)).join("\n");
}

"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import type { GodChatQuestion } from "@shared/god-chat";

export function askAnswerText(questions: GodChatQuestion[], picks: string[][], others: string[]): string {
  return questions
    .map((question, index) => `${question.question} ${[...picks[index], ...(others[index].trim() ? [others[index].trim()] : [])].join(" / ")}`)
    .join("\n");
}

export function AskCard({ questions, active, onAnswer }: { questions: GodChatQuestion[]; active: boolean; onAnswer: (text: string) => void }) {
  const [picks, setPicks] = useState<string[][]>(() => questions.map(() => []));
  const [others, setOthers] = useState<string[]>(() => questions.map(() => ""));
  const answered = questions.every((_, index) => picks[index].length > 0 || others[index].trim());

  function pick(index: number, label: string) {
    setPicks((current) => current.map((chosen, at) => {
      if (at !== index) return chosen;
      if (!questions[index].multiSelect) return chosen[0] === label ? [] : [label];
      return chosen.includes(label) ? chosen.filter((item) => item !== label) : [...chosen, label];
    }));
  }

  return (
    <section aria-label="Questions" className="mt-3 space-y-4 rounded-lg border border-line-strong bg-surface p-3">
      {questions.map((question, index) => (
        <fieldset key={index} disabled={!active} className="min-w-0 space-y-2">
          <legend className="label-mono text-[10px] text-muted-foreground">{question.header}{question.multiSelect && " · Choose any"}</legend>
          <p className="font-semibold">{question.question}</p>
          <div className="space-y-1.5">
            {question.options.map((option) => {
              const chosen = picks[index].includes(option.label);
              return (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => pick(index, option.label)}
                  className={cn(
                    "flex w-full flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors disabled:cursor-default",
                    chosen ? "border-foreground bg-surface-hover" : "border-line hover:bg-surface-hover",
                    !active && !chosen && "opacity-50",
                  )}
                >
                  <span className="text-sm">{option.label}</span>
                  {option.description && <span className="text-xs text-muted-foreground">{option.description}</span>}
                </button>
              );
            })}
            <input
              value={others[index]}
              onChange={(event) => setOthers((current) => current.map((value, at) => (at === index ? event.target.value : value)))}
              placeholder="Other…"
              maxLength={200}
              className="w-full rounded-md border border-line bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground"
            />
          </div>
        </fieldset>
      ))}
      {active && (
        <button
          type="button"
          disabled={!answered}
          onClick={() => onAnswer(askAnswerText(questions, picks, others))}
          className="rounded-md bg-foreground px-3 py-2 text-xs text-background disabled:opacity-40"
        >
          Send answers
        </button>
      )}
    </section>
  );
}

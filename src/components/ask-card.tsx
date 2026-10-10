"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import type { ChatAnswer } from "@/lib/chat-archive";
import type { GodChatQuestion } from "@shared/god-chat";

const NOTE_HEADER = "Note";

export function askAnswers(questions: GodChatQuestion[], picks: string[][], others: string[], note: string): ChatAnswer[] {
  const answers = questions
    .map((question, index) => ({
      header: question.header,
      question: question.question,
      answer: [...picks[index], ...(others[index].trim() ? [others[index].trim()] : [])].join(" / "),
    }))
    .filter(({ answer }) => answer);
  return note.trim() ? [...answers, { header: NOTE_HEADER, question: "", answer: note.trim() }] : answers;
}

// 空 question 是不属于任何问题的补充说明。
export function askAnswerText(answers: ChatAnswer[]): string {
  return answers.map(({ question, answer }) => (question ? `${question} ${answer}` : `Additional note: ${answer}`)).join("\n");
}

export function AnswerCard({ answers }: { answers: ChatAnswer[] }) {
  return (
    <dl aria-label="Answers" className="space-y-2 rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-foreground">
      {answers.map((item, index) => (
        <div key={index} className="min-w-0">
          <dt className="label-mono text-[10px] text-muted-foreground" title={item.question || undefined}>{item.header}</dt>
          <dd className="mt-1 whitespace-pre-wrap text-sm">{item.answer}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AskCard({ questions, active, onAnswer }: { questions: GodChatQuestion[]; active: boolean; onAnswer: (answers: ChatAnswer[]) => void }) {
  const [picks, setPicks] = useState<string[][]>(() => questions.map(() => []));
  const [others, setOthers] = useState<string[]>(() => questions.map(() => ""));
  const [otherOn, setOtherOn] = useState<boolean[]>(() => questions.map(() => false));
  const [note, setNote] = useState("");
  const chosenOthers = others.map((text, index) => (otherOn[index] ? text : ""));
  const answered = questions.every((_, index) => picks[index].length > 0 || chosenOthers[index].trim()) || Boolean(note.trim());

  function pick(index: number, label: string) {
    const single = !questions[index].multiSelect;
    setPicks((current) => current.map((chosen, at) => {
      if (at !== index) return chosen;
      if (single) return chosen[0] === label ? [] : [label];
      return chosen.includes(label) ? chosen.filter((item) => item !== label) : [...chosen, label];
    }));
    if (single) setOtherOn((current) => current.map((on, at) => (at === index ? false : on)));
  }

  function chooseOther(index: number) {
    if (otherOn[index]) return;
    setOtherOn((current) => current.map((on, at) => (at === index ? true : on)));
    if (!questions[index].multiSelect) setPicks((current) => current.map((chosen, at) => (at === index ? [] : chosen)));
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
              onFocus={() => chooseOther(index)}
              onChange={(event) => {
                chooseOther(index);
                setOthers((current) => current.map((value, at) => (at === index ? event.target.value : value)));
              }}
              placeholder="Other…"
              maxLength={200}
              aria-label={`Other answer: ${question.question}`}
              className={cn(
                "w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground",
                otherOn[index] ? "border-foreground bg-surface-hover" : "border-line bg-transparent",
                !active && !otherOn[index] && "opacity-50",
              )}
            />
          </div>
        </fieldset>
      ))}
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        disabled={!active}
        rows={2}
        maxLength={600}
        placeholder="Anything else to add…"
        aria-label="Additional note"
        className="scrollbar-none block w-full resize-none rounded-md border border-line bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground disabled:opacity-50 [&::-webkit-scrollbar]:hidden"
      />
      {active && (
        <button
          type="button"
          disabled={!answered}
          onClick={() => onAnswer(askAnswers(questions, picks, chosenOthers, note))}
          className="rounded-md bg-foreground px-3 py-2 text-xs text-background disabled:opacity-40"
        >
          Send answers
        </button>
      )}
    </section>
  );
}

"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";

import type { ChatBubble, ChatSession } from "@/lib/chat-archive";
import { chatCompletion, chatHistoryLines } from "@/lib/chat-completion";
import { GOD_CHAT_PRESETS } from "@shared/god-chat";
import { splitNextSuggestion } from "@shared/god-chat-next";

const PRESET_LINES = GOD_CHAT_PRESETS.map((preset) => preset.text);

export type Completion = ReturnType<typeof useCompletion>;

export function useCompletion({ inputRef, draft, setDraft, messages, sessions, blocked }: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (value: string) => void;
  messages: ChatBubble[];
  sessions: readonly ChatSession[];
  blocked: boolean;
}) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  // 记下取光标时的草稿：草稿被程序改写（发送后清空、采纳补全）时 select 事件不一定来，这时按光标在末尾算。
  const [caret, setCaret] = useState<{ value: string; atEnd: boolean } | null>(null);
  const history = useMemo(() => chatHistoryLines(sessions), [sessions]);
  const last = messages[messages.length - 1];
  const next = !blocked && last?.role === "assistant" && last.designAt === undefined ? splitNextSuggestion(last.content).next : undefined;
  const atEnd = caret?.value !== draft || caret.atEnd;
  const suffix = blocked || composing || !atEnd || dismissed === draft ? "" : chatCompletion(draft, next, [...PRESET_LINES, ...history]);

  function accept() {
    const value = draft + suffix;
    setDraft(value);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(value.length, value.length);
      el.scrollTop = el.scrollHeight;
    });
  }

  return {
    suffix,
    predicted: !draft && suffix !== "",
    accept,
    inputProps: {
      onSelect: (event: { currentTarget: HTMLTextAreaElement }) => {
        const el = event.currentTarget;
        setCaret({ value: el.value, atEnd: el.selectionStart === el.selectionEnd && el.selectionEnd === el.value.length });
      },
      onInput: () => setDismissed(null),
      onCompositionStart: () => setComposing(true),
      onCompositionEnd: () => setComposing(false),
    },
    // 处理了就返回 true；没有补全时 Tab 留给浏览器切换焦点。
    keyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
      if (!suffix || event.nativeEvent.isComposing) return false;
      if (event.key === "Tab" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        accept();
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(draft);
        return true;
      }
      return false;
    },
  };
}

// 与 textarea 叠在同一个网格格子里：镜像层草稿透明、只显出灰字，格子高度取两者较高，补全折行时输入框跟着长高。
export function CompletionField({ completion, draft, children }: { completion: Completion; draft: string; children: ReactNode }) {
  const mirrorRef = useRef<HTMLDivElement>(null);
  return (
    <div
      onScrollCapture={(event) => {
        if (mirrorRef.current && event.target instanceof HTMLTextAreaElement) mirrorRef.current.scrollTop = event.target.scrollTop;
      }}
      className="grid min-w-0 flex-1 [&>*]:[grid-area:1/1]"
    >
      {children}
      <div
        ref={mirrorRef}
        aria-hidden
        className="pointer-events-none max-h-32 min-h-10 overflow-hidden rounded-md border border-transparent px-3 py-2 text-base whitespace-pre-wrap [overflow-wrap:break-word] sm:text-sm"
      >
        <span className="text-transparent">{draft.endsWith("\n") ? `${draft}\u200b` : draft}</span>
        {completion.suffix && (
          // 键盘上的等价操作是输入框里的 Tab；这层 aria-hidden，点击只给触屏和鼠标。
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
          <span
            onMouseDown={(event) => event.preventDefault()}
            onClick={completion.accept}
            className="pointer-events-auto cursor-text text-muted-foreground"
          >
            {completion.suffix}
            {/* 键帽按行盒居中：align-middle 对的是西文 x 高，中文字形的中线比它高，键帽看着偏低。 */}
            <span className="ml-1.5 hidden h-lh items-center align-top pointer-fine:inline-flex">
              <kbd className="label-mono rounded border border-line-strong px-1 py-0.5">Tab</kbd>
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

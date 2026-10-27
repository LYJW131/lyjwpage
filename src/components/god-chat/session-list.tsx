"use client";

import { Trash2 } from "lucide-react";

import { chatArchive, type ChatArchive, type ChatSession } from "@/lib/chat-archive";
import { cn } from "@/lib/utils";

// 存储层总留一条空会话给输入框当草稿；只有带消息的会话才算存档，列表与计数都不含草稿。
export function savedSessions(archive: ChatArchive): ChatSession[] {
  return archive.sessions.filter((session) => session.messages.length > 0);
}

export function SessionList({ archive }: { archive: ChatArchive }) {
  const sessions = savedSessions(archive);
  function remove(id: string) {
    chatArchive.remove(id);
    if (!chatArchive.getSnapshot().sessions.length) chatArchive.start();
  }
  return (
    <div className="border-b border-line bg-muted px-4 py-2 lg:px-5">
      <div className="mb-2 flex items-center justify-between gap-2 text-2xs text-muted-foreground">
        <span>{sessions.length ? "Saved in this browser" : "No saved conversations yet"}</span>
        {sessions.length > 0 && <button type="button" onClick={() => { if (window.confirm("Clear all conversations saved in this browser? This cannot be undone.")) { chatArchive.clear(); chatArchive.start(); } }} className="hover:text-signal-red">Clear all conversations</button>}
      </div>
      {sessions.length > 0 && <ul className="scrollbar-none max-h-36 snap-y snap-mandatory overflow-y-auto [&::-webkit-scrollbar]:hidden">
        {sessions.map((session) => (
          <li key={session.id} className="flex h-11 snap-start items-center gap-2">
            <button type="button" aria-current={session.id === archive.activeId ? "true" : undefined} onClick={() => chatArchive.select(session.id)} className={cn("flex min-w-0 flex-1 items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs", session.id === archive.activeId ? "bg-surface text-foreground" : "text-muted-foreground hover:bg-surface-hover")}>
              <span className="truncate">{session.title}</span>
              <time className="shrink-0 text-2xs" dateTime={new Date(session.updatedAt).toISOString()}>{new Date(session.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</time>
            </button>
            <button type="button" aria-label={`Delete conversation: ${session.title}`} onClick={() => remove(session.id)} className="p-2 text-muted-foreground hover:text-signal-red"><Trash2 className="size-3.5" /></button>
          </li>
        ))}
      </ul>}
    </div>
  );
}

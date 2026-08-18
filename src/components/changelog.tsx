"use client";

import { ArrowUpRight, X } from "lucide-react";
import { Fragment, useEffect, useRef } from "react";

import {
  closeChangelog,
  dismissChangelog,
  openChangelog,
  seedSeen,
  useChangelog,
} from "@/hooks/use-changelog";
import {
  CHANGELOG,
  KIND_LABEL,
  compareRef,
  displayDate,
  type ChangelogEntry,
} from "@/lib/changelog";
import { site } from "@/lib/site";

const TITLE_ID = "changelog-title";

/**
 * 面板底部那行「当前构建」。
 *
 * 由服务端算好、当 props 传进来，而不是在这里 import lib/build-info —— 那个模块
 * 会现造一个 Intl.DateTimeFormat，引进客户端组件就等于把它连同格式化逻辑一起
 * 发给每个访客，只为了三个已经定死的字符串。页脚那份仍然是服务端的字面量。
 */
export type BuildStamp = {
  /** 短 sha，拿不到就是 null，见 lib/build-info */
  commit: string | null;
  buildTime: string | null;
};

/**
 * 页脚常驻的那个入口。没有未读时它是唯一的入口 —— 少了它，更新日志在「都看过」
 * 之后就再也找不到了。
 */
export function ChangelogLink() {
  return (
    <button
      type="button"
      onClick={openChangelog}
      className="cursor-pointer transition-colors hover:text-foreground"
    >
      更新日志
    </button>
  );
}

/**
 * 有未读时页脚上方的那条窄条，加上面板本身。
 *
 * 面板挂在这里而不是跟着窄条一起消失：常驻入口（上面那个 ChangelogLink）也要
 * 开它，而窄条在「都看过」之后就不渲染了。`<dialog>` 打开时进的是 top layer，
 * 所以它在 DOM 里排在哪一层不影响盖住谁。
 *
 * 窄条是水合之后才出现的（服务端那一遍读不到 localStorage，见 use-changelog），
 * 它在页脚上方，撑开的那一下多数时候发生在首屏之外。
 */
export function ChangelogPanel({ build }: { build: BuildStamp }) {
  const { unread, open, readUpTo } = useChangelog();
  const dialog = useRef<HTMLDialogElement>(null);

  // 第一次来的人：悄悄记下当前进度，不提示。不记的话他永远收不到提示
  useEffect(() => {
    seedSeen();
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // 只在两侧不一致时动手：showModal() 对已经开着的 dialog 会抛
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  /**
   * 「以下是你看过的」画在哪一条之前。
   *
   * 上面确实有没看过的、下面确实还有看过的，这条线才有意义 —— 所以 index 为 0
   * （一条都没新的）和 -1（整份都是新的，多半是第一次打开）都不画。
   */
  const dividerIndex =
    readUpTo == null ? -1 : CHANGELOG.findIndex((entry) => entry.version <= readUpTo);

  return (
    <>
      {unread > 0 && (
        <div className="paper-card mb-3 flex items-stretch border border-line-strong bg-surface">
          <button
            type="button"
            onClick={openChangelog}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-hover"
          >
            <span className="label-mono shrink-0 border border-line-strong px-1.5 py-1 text-foreground">
              {unread}
            </span>
            <span className="label-mono shrink-0 text-muted-foreground">项更新</span>
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">
              {CHANGELOG[0].title}
            </span>
            <span className="label-mono shrink-0 text-muted-foreground">查看</span>
          </button>
          <button
            type="button"
            onClick={dismissChangelog}
            aria-label="标记为已看过"
            className="flex cursor-pointer items-center border-l border-line px-2.5 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      )}

      <dialog
        ref={dialog}
        aria-labelledby={TITLE_ID}
        onClose={closeChangelog}
        // 点面板外面关掉。事件冒到 dialog 自己身上才算「点在外面」——
        // 点在面板里的话 target 是面板里的某个元素
        onClick={(event) => {
          if (event.target === dialog.current) closeChangelog();
        }}
        className="m-auto w-[calc(100vw-2rem)] max-w-xl border-0 bg-transparent p-0 text-foreground"
      >
        {/* 关着的时候不渲染内容：整份条目就不进首屏那份静态 HTML 了 */}
        {open && (
          <div className="paper-card flex max-h-[80svh] flex-col overflow-hidden border border-line-strong bg-surface">
            <div className="flex min-h-9 shrink-0 items-center justify-between gap-2 border-b border-line bg-muted px-3 py-2">
              <span id={TITLE_ID} className="label-mono text-muted-foreground">
                更新日志
              </span>
              <button
                type="button"
                onClick={closeChangelog}
                aria-label="关闭"
                className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>

            {/* overscroll-contain：滚到头之后别把身后的页面也带着滚 */}
            <div className="overflow-y-auto overscroll-contain">
              {CHANGELOG.map((entry, index) => (
                <Fragment key={entry.version}>
                  {index === dividerIndex && index > 0 && (
                    <div className="label-mono border-y border-line bg-muted px-4 py-1.5 text-muted-foreground">
                      以下是你看过的
                    </div>
                  )}
                  <Entry entry={entry} index={index} />
                </Fragment>
              ))}
            </div>

            <div className="label-mono flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line bg-muted px-4 py-2 text-muted-foreground">
              <span>当前构建</span>
              <span className="flex items-center gap-2">
                {/* label-mono 会转大写，sha 得躲开 —— 和页脚那处同一个理由 */}
                {build.commit && <span className="normal-case">{build.commit}</span>}
                {build.buildTime && <span>{build.buildTime}</span>}
              </span>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

function Entry({ entry, index }: { entry: ChangelogEntry; index: number }) {
  const ref = compareRef(index);

  return (
    <article className="border-b border-line px-4 py-4 last:border-b-0">
      {/*
        窄屏换成上下两行。挤在一行时标题会折下来、而日期还钉在右上角，
        中间留一道没来由的空档 —— 那正是手机上最常见的宽度。
      */}
      <header className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="label-mono shrink-0 text-muted-foreground">
            REV_{String(entry.version).padStart(3, "0")}
          </span>
          <h3 className="text-sm font-medium">{entry.title}</h3>
        </div>
        <time dateTime={entry.date} className="label-mono shrink-0 text-muted-foreground">
          {displayDate(entry.date)}
        </time>
      </header>

      <ul className="mt-2.5 space-y-1.5">
        {entry.notes.map((note) => (
          <li key={note.text} className="flex gap-2.5 text-xs leading-relaxed">
            {/* 固定宽度，三种类型的正文才对得齐一列 */}
            <span className="label-mono w-8 shrink-0 pt-[0.25em] text-muted-foreground">
              {KIND_LABEL[note.kind]}
            </span>
            <span className="min-w-0">{note.text}</span>
          </li>
        ))}
      </ul>

      {ref && (
        <a
          href={`${site.repo}/${ref}`}
          target="_blank"
          rel="noreferrer"
          className="label-mono mt-3 inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          这段提交
          <ArrowUpRight className="size-3" aria-hidden />
        </a>
      )}
    </article>
  );
}

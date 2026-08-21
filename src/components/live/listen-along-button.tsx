"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { CircleStop, Headphones, LoaderCircle, TriangleAlert, X } from "lucide-react";

import type { ListenAlong } from "@/hooks/use-listen-along";
import { cn } from "@/lib/utils";

/**
 * 卡片右上角那个「一起听」。
 *
 * 点开先出说明：授权自己的订阅、站点不转音频不存凭据，并标明这是测试功能。
 * 真的出声之后按钮才变绿；静音加载时还是「连接中」。
 */

function face(listen: ListenAlong) {
  const loading =
    listen.status === "starting" || (listen.status === "following" && !listen.audible && !listen.waiting);
  if (loading) {
    return {
      icon: <LoaderCircle className="size-3 shrink-0 animate-spin" aria-hidden />,
      text: "连接中",
      label: "正在加载，还没出声",
    };
  }
  if (listen.status === "error") {
    return {
      icon: <TriangleAlert className="size-3 shrink-0" aria-hidden />,
      text: "重试",
      label: `一起听没能开始：${listen.error ?? "未知错误"}。点击打开说明`,
    };
  }
  if (listen.status === "following") {
    return {
      icon: <CircleStop className="size-3 shrink-0" aria-hidden />,
      text: listen.waiting ? "待命中" : "一起听",
      label: listen.waiting
        ? "已连接，等主人开始播放。点击打开说明"
        : "正在一起听。点击打开说明",
    };
  }
  return {
    icon: <Headphones className="size-3 shrink-0" aria-hidden />,
    text: "一起听",
    label: "打开一起听说明",
  };
}

function DialogButton({
  children,
  onClick,
  disabled,
  tone = "plain",
}: {
  children: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "plain" | "live";
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "label-mono min-w-0 flex-1 border px-3 py-2 transition-colors disabled:cursor-default disabled:opacity-60",
        tone === "live"
          ? "border-live/40 text-live hover:bg-surface-hover"
          : "border-line-strong hover:bg-surface-hover hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ListenAlongDialog({
  listen,
  onClose,
}: {
  listen: ListenAlong;
  onClose: () => void;
}) {
  const titleId = useId();
  const busy = listen.status === "starting";
  const { probe } = listen;

  useEffect(() => {
    probe();
  }, [probe]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-background/80"
        aria-label="关闭"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="paper-card relative w-full max-w-sm rounded-lg border border-line-strong bg-surface"
      >
        <header className="flex items-center justify-between gap-2 border-b border-line bg-muted px-3 py-2">
          <span id={titleId} className="label-mono text-muted-foreground">
            一起听
          </span>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </header>
        <div className="px-4 py-3">
          <p className="text-sm leading-relaxed text-foreground">
            请登录有效的 Apple Music 订阅授权。站点不转发音频、储存凭据，仅同步播放曲目和进度。
          </p>
          <p className="label-mono mt-2 text-muted-foreground">注意：这是一个测试功能</p>
          {listen.error ? (
            <p className="mt-2 text-sm text-muted-foreground">{listen.error}</p>
          ) : null}
          <div className="mt-4 flex gap-2">
            {listen.authorized ? (
              <>
                {listen.status === "following" ? (
                  <DialogButton
                    disabled={busy}
                    onClick={() => {
                      listen.stop();
                      onClose();
                    }}
                  >
                    停止
                  </DialogButton>
                ) : (
                  <DialogButton tone="live" disabled={busy} onClick={listen.start}>
                    {busy ? "连接中" : "开始"}
                  </DialogButton>
                )}
                <DialogButton
                  disabled={busy}
                  onClick={() => {
                    listen.logout();
                    onClose();
                  }}
                >
                  登出
                </DialogButton>
              </>
            ) : (
              <DialogButton tone="live" disabled={busy} onClick={listen.start}>
                {busy ? "连接中" : "登录"}
              </DialogButton>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ListenAlongButton({ listen }: { listen: ListenAlong }) {
  const [open, setOpen] = useState(false);

  if (listen.status === "unavailable") return null;

  const { icon, text, label } = face(listen);
  const live = listen.status === "following" && listen.audible && !listen.waiting;

  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={listen.status === "error" ? (listen.error ?? undefined) : label}
        onClick={() => setOpen(true)}
        className={cn(
          "label-mono -my-1 flex items-center gap-1.5 rounded-sm border px-1.5 py-1",
          "transition-colors",
          live
            ? "border-live/40 text-live hover:bg-surface-hover"
            : "border-line text-muted-foreground hover:bg-surface-hover hover:text-foreground",
        )}
      >
        {icon}
        <span>{text}</span>
      </button>
      {open ? <ListenAlongDialog listen={listen} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

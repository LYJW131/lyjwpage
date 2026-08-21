"use client";

import { CircleStop, Headphones, LoaderCircle, TriangleAlert } from "lucide-react";

import type { ListenAlong } from "@/hooks/use-listen-along";
import { cn } from "@/lib/utils";

/**
 * 卡片右上角那个「一起听」。
 *
 * 长在 Card 的 action 槽里，和「Apple Music」那行小字换位 —— 那一行本来就是
 * 用来说明这张卡的来源的，而在有东西可跟听的时候，「你也能听」比「这是 Apple
 * Music」更值得占这个位置。槽位是 shrink-0 的等宽小字，所以这里的尺寸一律按
 * label-mono 那套走，不另起一套按钮样式。
 */

/** 每个状态对应的图标、文案和无障碍标签。集中放一处，省得散在 JSX 里对不上 */
function face(listen: ListenAlong) {
  if (listen.status === "starting") {
    return {
      icon: <LoaderCircle className="size-3 shrink-0 animate-spin" aria-hidden />,
      text: "连接中",
      label: "正在连接 Apple Music",
    };
  }
  if (listen.status === "error") {
    return {
      icon: <TriangleAlert className="size-3 shrink-0" aria-hidden />,
      text: "重试",
      label: `一起听没能开始：${listen.error ?? "未知错误"}。点击重试`,
    };
  }
  if (listen.status === "following") {
    return {
      icon: <CircleStop className="size-3 shrink-0" aria-hidden />,
      // 主人没在放时也停在 following，说清楚是在待命而不是断了
      text: listen.waiting ? "待命中" : "跟听中",
      label: listen.waiting
        ? "已连接，等主人开始播放。点击停止跟听"
        : "正在跟着一起听。点击停止",
    };
  }
  return {
    icon: <Headphones className="size-3 shrink-0" aria-hidden />,
    text: "一起听",
    label: "用你自己的 Apple Music 订阅，跟着一起听这首",
  };
}

export function ListenAlongButton({ listen }: { listen: ListenAlong }) {
  if (listen.status === "unavailable") return null;

  const { icon, text, label } = face(listen);
  const following = listen.status === "following";
  const busy = listen.status === "starting";

  return (
    <button
      type="button"
      // 连接中不让点：那期间可能正开着 Apple 的授权弹窗，再点一次只会再配一遍
      disabled={busy}
      aria-label={label}
      title={listen.status === "error" ? (listen.error ?? undefined) : label}
      onClick={following ? listen.stop : listen.start}
      className={cn(
        "label-mono -my-1 flex items-center gap-1.5 rounded-sm border px-1.5 py-1",
        "transition-colors disabled:cursor-default",
        listen.status === "error"
          ? "border-line text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          : following && !listen.waiting
            ? // 真的在出声时才点亮，待命时保持安静
              "border-live/40 text-live hover:bg-surface-hover"
            : "border-line text-muted-foreground hover:bg-surface-hover hover:text-foreground",
      )}
    >
      {icon}
      <span>{text}</span>
    </button>
  );
}

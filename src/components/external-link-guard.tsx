"use client";

import { ExternalLink, X } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";

import { MODAL_ACTION_CLASS, Modal } from "@/components/ui/modal";
import { describeExternalLink } from "@/lib/external-link";

type Pending = { url: URL; newTab: boolean };

const listeners = new Set<(pending: Pending) => void>();

function externalUrl(raw: string): URL | null {
  try {
    const url = new URL(raw, window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin === window.location.origin ? null : url;
  } catch {
    return null;
  }
}

export function confirmExternalOpen(raw: string) {
  const url = externalUrl(raw);
  if (!url) {
    window.open(raw, "_blank", "noopener,noreferrer");
    return;
  }
  for (const listener of listeners) listener({ url, newTab: true });
}

export function ExternalLinkGuard() {
  const [pending, setPending] = useState<Pending | null>(null);
  const close = useCallback(() => setPending(null), []);

  useEffect(() => {
    listeners.add(setPending);
    // 只拦页面上一次点击就离站的链接：弹层里的链接是点开弹层后的第二次点击，本身已是确认，不再拦。
    // 冒泡阶段挂在 window 上：组件自己 preventDefault 接管的点击（如打开站内弹层）先处理，这里跳过。
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (event.type === "click" ? event.button !== 0 : event.button !== 1) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      const href = anchor?.getAttribute("href");
      if (!anchor || !href || anchor.hasAttribute("download") || anchor.closest('[role="dialog"]')) return;
      const url = externalUrl(href);
      if (!url) return;
      event.preventDefault();
      const newTab = event.type === "auxclick" || event.metaKey || event.ctrlKey || event.shiftKey
        || anchor.getAttribute("target") === "_blank";
      setPending({ url, newTab });
    };
    window.addEventListener("click", onClick);
    window.addEventListener("auxclick", onClick);
    return () => {
      listeners.delete(setPending);
      window.removeEventListener("click", onClick);
      window.removeEventListener("auxclick", onClick);
    };
  }, []);

  if (!pending) return null;
  return <ConfirmDialog pending={pending} onClose={close} />;
}

function ConfirmDialog({ pending, onClose }: { pending: Pending; onClose: () => void }) {
  const titleId = useId();
  const { url, newTab } = pending;
  const open = () => {
    onClose();
    if (newTab) window.open(url.href, "_blank", "noopener,noreferrer");
    else window.location.assign(url.href);
  };
  return (
    <Modal titleId={titleId} onClose={onClose}>
      <header className="flex items-center justify-between gap-2 px-4">
        <h2 id={titleId} className="text-sm font-medium">Leave this site?</h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex size-6 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </header>
      <div className="grid gap-1 px-4 pt-3 pb-4">
        <p className="text-sm">{describeExternalLink(url)}</p>
        <p className="line-clamp-3 text-xs break-words text-muted-foreground">{url.href}</p>
      </div>
      <div className="flex border-t border-line">
        <button
          type="button"
          onClick={onClose}
          className={MODAL_ACTION_CLASS}
        >
          Cancel
        </button>
        <div className="w-px self-stretch bg-line" aria-hidden />
        <button
          type="button"
          onClick={open}
          className={MODAL_ACTION_CLASS}
        >
          <span>Open</span>
          <ExternalLink className="size-3 shrink-0" aria-hidden />
        </button>
      </div>
    </Modal>
  );
}

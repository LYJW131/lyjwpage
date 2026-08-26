"use client";

import Link from "next/link";
import { useReducedMotion } from "motion/react";

import { site } from "@/lib/site";

/**
 * 左上角的站名。语义仍是「回首页」的链接（中键新开、复制地址都照常），
 * 但已经在首页时 Next 的同路由导航什么都不滚 —— 这里拦下来自己滚回顶部，
 * 并把地址上残留的锚点（#playing 之类）一并清掉。
 */
export function HomeLink() {
  const reduced = useReducedMotion();
  return (
    <Link
      href="/"
      className="min-w-0 justify-self-start truncate text-sm font-bold tracking-tight"
      onClick={(event) => {
        if (window.location.pathname !== "/") return;
        event.preventDefault();
        if (window.location.hash) history.replaceState(null, "", "/");
        window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
      }}
    >
      <span className="sm:hidden">{site.shortName}</span>
      <span className="hidden sm:inline">{site.name}</span>
    </Link>
  );
}

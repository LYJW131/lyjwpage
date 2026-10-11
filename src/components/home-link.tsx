"use client";

import Link from "next/link";
import { useReducedMotion } from "motion/react";

import { site } from "@/lib/site";

// Next 同路由导航不会滚到顶，需要自行处理首页点击。
export function HomeLink({ heading = false }: { heading?: boolean }) {
  const reduced = useReducedMotion();
  const label = (
    <>
      <span className="sm:hidden">{site.shortName}</span>
      <span className="hidden sm:inline">{site.name}</span>
    </>
  );
  return (
    <Link
      href="/"
      prefetch={false}
      className="-m-2 min-w-0 justify-self-start truncate p-2 text-sm font-bold tracking-tight"
      onClick={(event) => {
        if (window.location.pathname !== "/") return;
        event.preventDefault();
        if (window.location.hash) history.replaceState(null, "", "/");
        window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
      }}
    >
      {heading ? <h1 className="inline">{label}</h1> : label}
    </Link>
  );
}

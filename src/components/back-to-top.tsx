"use client";

import { useReducedMotion } from "motion/react";

export function BackToTop() {
  const reduced = useReducedMotion();
  return (
    <a
      href="#top"
      className="inline-flex min-h-11 items-center px-3 text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline hover:underline-offset-4 focus-visible:text-foreground focus-visible:underline focus-visible:underline-offset-4"
      onClick={(event) => {
        event.preventDefault();
        if (window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search);
        window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
        document.getElementById("top")?.focus({ preventScroll: true });
      }}
    >
      <span aria-hidden="true">↑&nbsp;</span>Back to top
    </a>
  );
}

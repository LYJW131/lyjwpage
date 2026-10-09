"use client";

import { useEffect, useRef, useState } from "react";

const QUIPS = [
  "This page went out to get milk.",
  "404: page is doing a side quest.",
  "You found nothing. Congratulations, that's rare.",
  "Even the Claude mascot couldn't fetch this one.",
  "The page is on a coffee break. A long one.",
  "We looked under the couch. Not there either.",
  "This URL leads to a very nice void.",
  "Somewhere, a link is feeling guilty.",
  "The page has left the chat.",
  "Plot twist: there was never a page.",
  "You've reached the edge of the map.",
  "Nothing to see here. Literally.",
] as const;

function pickQuip(current: string | null) {
  const pool = QUIPS.filter((quip) => quip !== current);
  return pool[Math.floor(Math.random() * pool.length)];
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function NotFoundQuip() {
  const [quip, setQuip] = useState<string | null>(null);
  const numberRef = useRef<HTMLButtonElement>(null);
  const quipRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!quip || prefersReducedMotion()) return;
    quipRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 200,
      easing: "ease-out",
    });
  }, [quip]);

  return (
    <>
      <button
        ref={numberRef}
        type="button"
        aria-label="404"
        onClick={() => {
          setQuip((current) => pickQuip(current));
          if (prefersReducedMotion()) return;
          numberRef.current?.animate(
            [
              { transform: "scale(1)" },
              { transform: "scale(0.92)" },
              { transform: "scale(1)" },
            ],
            { duration: 200, easing: "ease-out" },
          );
        }}
        className="label-mono cursor-pointer select-none rounded-sm text-3xl font-bold tracking-widest text-foreground [-webkit-tap-highlight-color:transparent] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-live sm:text-4xl"
      >
        404
      </button>
      <div aria-live="polite" className="w-full">
        {quip ? (
          <p
            ref={quipRef}
            key={quip}
            className="mt-2 text-xs leading-relaxed break-words text-muted-foreground"
          >
            {quip}
          </p>
        ) : null}
      </div>
    </>
  );
}

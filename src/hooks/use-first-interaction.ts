"use client";

import { useEffect, useState } from "react";

const SIGNALS = ["pointerdown", "keydown", "touchstart", "wheel", "scroll"] as const;

export function useFirstInteraction(): boolean {
  const [interacted, setInteracted] = useState(false);

  useEffect(() => {
    if (interacted) return;
    const fire = () => setInteracted(true);
    const options = { passive: true, once: true } as const;
    for (const signal of SIGNALS) {
      const target = signal === "scroll" ? window : document;
      target.addEventListener(signal, fire, options);
    }
    return () => {
      for (const signal of SIGNALS) {
        const target = signal === "scroll" ? window : document;
        target.removeEventListener(signal, fire);
      }
    };
  }, [interacted]);

  return interacted;
}

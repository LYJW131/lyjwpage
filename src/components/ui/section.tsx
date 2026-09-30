import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Section({
  id,
  label,
  title,
  note,
  children,
  className,
}: {
  id?: string;
  label?: string;
  title?: string;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn("scroll-mt-28 px-4 py-8 sm:px-6 sm:py-10", className)}
    >
      {(label || title) && (
        <header className="mb-5 flex items-baseline justify-between gap-4 border-b border-line pb-3">
          <div className="flex items-baseline gap-3">
            {label && <span className="label-mono text-muted-foreground">{label}</span>}
            {title && (
              <h2 className="text-lg font-bold tracking-tight sm:text-xl">{title}</h2>
            )}
          </div>
          {note && <div className="label-mono text-muted-foreground shrink-0">{note}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function StripeDivider() {
  return (
    <div className="screen-line-top screen-line-bottom relative h-8">
      <div className="stripe-divider absolute inset-0" />
    </div>
  );
}


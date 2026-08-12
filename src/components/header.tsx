import { ThemeToggle } from "@/components/theme-toggle";
import { StatusDot } from "@/components/ui/status-dot";
import { site } from "@/lib/site";

export function Header() {
  return (
    <header id="top" className="relative z-50">
      <div className="mx-auto w-[calc(100%-2rem)] max-w-5xl pt-4 sm:pt-6">
        <div className="flex min-h-10 items-center gap-3">
          <a href="#top" className="shrink-0 text-sm font-bold tracking-tight">
            {site.name}
          </a>
          <span className="signal-spectrum h-3 min-w-8 flex-1 border-y border-line-strong" aria-hidden />
          <span className="label-mono hidden shrink-0 text-muted-foreground sm:inline">
            SG / UTC+8
          </span>
          <ThemeToggle />
        </div>

        <nav className="mt-2 grid grid-cols-3 gap-1" aria-label="页面区块">
          <a href="#live" className="nav-cell">
            <StatusDot tone="live" />
            <span>Live</span>
          </a>
          <a href="#vibe-coding" className="nav-cell">Vibe Coding</a>
          <a href="#watching" className="nav-cell">Media</a>
        </nav>
      </div>
    </header>
  );
}

import { ThemeToggle } from "@/components/theme-toggle";
import { site } from "@/lib/site";

const NAV = [
  { label: "状态", href: "#live" },
  { label: "关于", href: "#about" },
  { label: "项目", href: "#projects" },
];

export function Header() {
  return (
    // 全站唯一用磨砂的地方
    <header className="sticky top-0 z-50 border-b border-line bg-background/72 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
        <a href="#top" className="font-mono text-sm font-medium tracking-tight">
          {site.name}
          <span className="text-muted-foreground">.dev</span>
        </a>

        <nav className="flex items-center gap-1">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
          <div className="ml-1.5">
            <ThemeToggle />
          </div>
        </nav>
      </div>
    </header>
  );
}

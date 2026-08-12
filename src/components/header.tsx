import { ThemeToggle } from "@/components/theme-toggle";
import { site } from "@/lib/site";

export function Header() {
  return (
    // 全站唯一用磨砂的地方
    <header className="sticky top-0 z-50 border-b border-line bg-background/72 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
        <a href="#top" className="font-mono text-sm font-medium tracking-tight">
          {site.name}
        </a>

        {/* 导航等其他 section 加回来了再补 */}
        <ThemeToggle />
      </div>
    </header>
  );
}

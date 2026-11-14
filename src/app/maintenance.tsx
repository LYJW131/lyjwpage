import { Footer } from "@/components/footer";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card } from "@/components/ui/card";
import { site } from "@shared/site";

export default function Maintenance() {
  return (
    <>
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
        <div className="mx-auto w-[calc(100%-2rem)] max-w-5xl py-3 sm:py-4">
          <div className="flex min-h-10 items-center justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-bold tracking-tight">
              <span className="sm:hidden">{site.shortName}</span>
              <span className="hidden sm:inline">{site.name}</span>
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center py-8">
        <div className="mx-auto w-[calc(100%-2rem)] max-w-md">
          <Card label="MAINTENANCE" tone="idle">
            <div className="flex flex-col items-center gap-3 p-6 text-center sm:p-8">
              <div className="label-mono text-3xl font-bold tracking-widest text-foreground sm:text-4xl">
                Be right back
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                The site is down for maintenance. Please check back in a little while.
              </p>
            </div>
          </Card>
        </div>
      </main>

      <Footer />
    </>
  );
}

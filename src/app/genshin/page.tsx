import type { Metadata } from "next";
import Link from "next/link";

import { Footer } from "@/components/footer";
import { HomeLink } from "@/components/home-link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Genshin Impact",
  description: "A page dedicated to Genshin Impact.",
};

const facts = [
  { label: "Developer", value: "HoYoverse" },
  { label: "Released", value: "Sep 28, 2020" },
  { label: "Genre", value: "Open-world action RPG" },
  { label: "Platforms", value: "PC · PlayStation · iOS · Android" },
];

const links = [
  { label: "Official site", href: "https://genshin.hoyoverse.com/" },
  { label: "HoYoLAB", href: "https://www.hoyolab.com/" },
];

const linkClassName =
  "paper-card inline-flex h-8 items-center justify-center rounded-md border border-line-strong bg-surface px-4 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover";

export default function GenshinPage() {
  return (
    <>
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
        <div className="mx-auto w-[calc(100%-2rem)] max-w-5xl py-3 sm:py-4">
          <div className="flex min-h-10 items-center justify-between gap-3">
            <HomeLink />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 py-8 sm:py-12">
        <div className="mx-auto flex w-[calc(100%-2rem)] max-w-2xl flex-col gap-4">
          <Card label="GENSHIN IMPACT">
            <div className="p-6 sm:p-8">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Genshin Impact</h1>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                An open-world action RPG set in Teyvat, a land of seven nations each tied to an
                element and its archon. Travel, explore, and fight with a party of four switchable
                characters.
              </p>
            </div>
          </Card>

          <Card label="ABOUT">
            <dl className="divide-y divide-line">
              {facts.map((fact) => (
                <div key={fact.label} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                  <dt className="label-mono text-muted-foreground">{fact.label}</dt>
                  <dd className="text-right text-foreground">{fact.value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <div className="flex flex-wrap gap-2">
            {links.map((link) => (
              <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className={linkClassName}>
                {link.label}
              </a>
            ))}
            <Link href="/" className={linkClassName}>
              Back to home
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </>
  );
}

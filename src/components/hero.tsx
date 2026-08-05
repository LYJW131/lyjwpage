import { Clapperboard, Link2, Mail, Music, Rss } from "lucide-react";
import type { ComponentType } from "react";

import { GithubMark } from "@/components/icons";
import { LocalTime } from "@/components/local-time";
import { site, socials, type SocialLink } from "@/lib/site";

const ICONS: Record<SocialLink["icon"], ComponentType<{ className?: string }>> = {
  github: GithubMark,
  mail: Mail,
  rss: Rss,
  link: Link2,
  music: Music,
  clapperboard: Clapperboard,
};

export function Hero() {
  return (
    <section id="top" className="px-4 pb-10 pt-12 sm:pb-14 sm:pt-16">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xl">
          <div className="label-mono mb-4 flex items-center gap-2 text-muted-foreground">
            <span>FIG_001</span>
            <span className="h-px w-6 bg-line" />
            <span>Personal Telemetry</span>
          </div>

          <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">
            {site.fullName}
            <span className="ml-2 font-mono text-xl text-muted-foreground">
              / {site.name}
            </span>
          </h1>

          <p className="mt-3 text-balance leading-relaxed text-muted-foreground">
            {site.tagline}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            {socials.map((link) => {
              const Icon = ICONS[link.icon];
              return (
                <a
                  key={link.label}
                  href={link.href}
                  target={link.href.startsWith("http") ? "_blank" : undefined}
                  rel="noreferrer noopener"
                  className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
                >
                  <Icon className="size-3.5" />
                  {link.label}
                </a>
              );
            })}
          </div>
        </div>

        {/* 右侧信息栏：等宽小字的「元数据」块 */}
        <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-2.5 text-sm sm:grid-cols-1 sm:text-right">
          <div className="flex items-baseline gap-2 sm:justify-end">
            <dt className="label-mono text-muted-foreground">本地时间</dt>
            <dd>
              <LocalTime />
            </dd>
          </div>
          <div className="flex items-baseline gap-2 sm:justify-end">
            <dt className="label-mono text-muted-foreground">位置</dt>
            <dd>{site.location}</dd>
          </div>
          <div className="flex items-baseline gap-2 sm:justify-end">
            <dt className="label-mono text-muted-foreground">域名</dt>
            <dd className="font-mono">{site.domain}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

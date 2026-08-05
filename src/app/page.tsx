import { Header } from "@/components/header";
import { Hero } from "@/components/hero";
import { ChargerCard } from "@/components/live/charger-card";
import { ListeningCard } from "@/components/live/listening-card";
import { WatchingRow } from "@/components/live/watching-card";
import { Container, Section, StripeDivider } from "@/components/ui/section";
import { projects, site, timeline } from "@/lib/site";

const STATUS_TONE = {
  active: "bg-live",
  wip: "bg-live-idle",
  archived: "bg-live-off",
} as const;

export default function Home() {
  return (
    <>
      <Header />

      <main className="flex-1">
        <Container>
          <Hero />

          <StripeDivider />

          {/* 实时状态区：全站唯一允许出现彩色的地方 */}
          <Section id="live" label="FIG_002" title="此刻" note="实时">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <ChargerCard />
              <ListeningCard />
            </div>

            <div className="mt-4">
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="text-sm font-medium">最近在看</h3>
                <span className="label-mono text-muted-foreground">Emby</span>
              </div>
              <WatchingRow />
            </div>
          </Section>

          <StripeDivider />

          <Section id="about" label="FIG_003" title="关于">
            <div className="grid gap-8 md:grid-cols-[1fr_16rem]">
              <div className="space-y-4 leading-relaxed text-muted-foreground">
                {site.bio.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>

              <ol className="space-y-4 border-l border-line pl-4">
                {timeline.map((entry) => (
                  <li key={entry.title} className="relative">
                    <span className="absolute -left-[1.3125rem] top-1.5 size-1.5 rounded-full bg-line-strong" />
                    <div className="label-mono text-muted-foreground">{entry.date}</div>
                    <div className="mt-1 text-sm font-medium">{entry.title}</div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {entry.description}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </Section>

          <StripeDivider />

          <Section
            id="projects"
            label="FIG_004"
            title="在做的东西"
            note={`${projects.length} 项`}
          >
            <ul className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2">
              {projects.map((project) => {
                const Wrapper = project.href ? "a" : "div";
                return (
                  <li key={project.name} className="bg-surface">
                    <Wrapper
                      {...(project.href
                        ? {
                            href: project.href,
                            target: "_blank",
                            rel: "noreferrer noopener",
                          }
                        : {})}
                      className="flex h-full flex-col p-4 transition-colors hover:bg-surface-hover"
                    >
                      <div className="flex items-center gap-2">
                        {project.status && (
                          <span
                            className={`size-1.5 rounded-full ${STATUS_TONE[project.status]}`}
                          />
                        )}
                        <span className="font-medium">{project.name}</span>
                      </div>
                      <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">
                        {project.description}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {project.tags.map((tag) => (
                          <span
                            key={tag}
                            className="label-mono rounded border border-line px-1.5 py-1 text-muted-foreground"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </Wrapper>
                  </li>
                );
              })}
            </ul>
          </Section>

          <StripeDivider />

          <footer className="flex flex-col gap-2 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              © {new Date().getFullYear()} {site.fullName}
            </span>
            <span className="label-mono">Next.js · 数据来自自建服务</span>
          </footer>
        </Container>
      </main>
    </>
  );
}

import { Header } from "@/components/header";
import { ContactCard } from "@/components/contact-card";
import { ChargerCard } from "@/components/live/charger-card";
import { ListeningCard } from "@/components/live/listening-card";
import { LiveDeskCard } from "@/components/live/live-desk-card";
import { TimezoneCard } from "@/components/live/timezone-card";
import { VibeCodingCard } from "@/components/live/vibecoding-card";
import { WatchingRow } from "@/components/live/watching-card";
import { Container, Section } from "@/components/ui/section";

export default function Home() {
  return (
    <>
      <Header />

      <main className="flex-1">
        <Container>
          <Section id="live" label="FIG_001" title="此刻" note="实时">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <LiveDeskCard />
              {/*
                充电头和听歌绑成一对：同一行里 items-stretch + 各自 h-full，
                避免两张卡各算各的固有高度、加载完一边突然变高。
              */}
              <div className="grid grid-cols-1 gap-4 md:col-span-2 md:grid-cols-2 md:items-stretch">
                <ChargerCard className="h-full" />
                <ListeningCard className="h-full" />
              </div>
              <VibeCodingCard />
              <TimezoneCard />
              <ContactCard />
            </div>

            <div className="mt-4">
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="text-sm font-medium">最近在看</h3>
                <span className="label-mono text-muted-foreground">Emby</span>
              </div>
              <WatchingRow />
            </div>
          </Section>
        </Container>
      </main>
    </>
  );
}

import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { WebPlayerProvider } from "@/components/web-player/web-player-provider";
import { AppVersionCard } from "@/components/app-version-card";
import { CardBoundary } from "@/components/card-boundary";
import { StaleTabReload } from "@/components/stale-tab-reload";
import { ContactCard } from "@/components/contact-card";
import { DevFakeDataToggle } from "@/components/dev-fake-data-toggle";
import { DevToggleDock } from "@/components/dev-toggles";
import { GodChat } from "@/components/god-chat";
import { WorkoutsStrip } from "@/components/live/workouts-strip";
import { ActivityCard } from "@/components/live/activity-card";
import { SiteStatusCard } from "@/components/live/site-status-card";
import { LiveMediaPair } from "@/components/live/media-pair";
import { ServerCard } from "@/components/live/server-card";
import { PlaystationBlock } from "@/components/live/playstation-block";
import { PulseCard } from "@/components/live/pulse-card";
import { TimezoneCard } from "@/components/live/timezone-card";
import { NowWatchingCard } from "@/components/live/now-watching-card";
import { QuestNowCard } from "@/components/live/quest-now-card";
import { AgentStatusCard } from "@/components/live/agent-status-card";
import { VibeCodingCard } from "@/components/live/vibecoding-card";
import { WatchingRow } from "@/components/live/watching-card";
import { Section } from "@/components/ui/section";
import { artworkPlaceholders } from "@/lib/artwork-placeholder";
import { desktopIconDataUri } from "@/lib/desktop-icon-inline";
import { APP_VERSION_PATH } from "@/lib/app-version";
import { liveTrack } from "@/lib/home-layout";
import {
  ACTIVITY_PATH,
  AGENT_STATUS_PATH,
  CHARGER_PATH,
  CLOUDFLARE_WORKERS_PATH,
  CODING_NOW_PATH,
  CODING_PATH,
  CODING_YEAR_PATH,
  GITHUB_CHART_PATH,
  GITHUB_REPO_PATH,
  LIMITS_PATH,
  LISTENING_PATH,
  NOW_LISTENING_PATH,
  NOW_PLAYING_PATH,
  NOW_WATCHING_PATH,
  PLAYING_PATH,
  POWERBANK_PATH,
  PULSE_PATH,
  REPORTERS_PATH,
  SENTRY_PATH,
  SERVER_PATH,
  TROPHIES_PATH,
  SITE_DEPLOYMENTS_PATH,
  WATCHING_PATH,
} from "@/lib/paths";
import {
  SITE_ASSET_METADATA_PATH,
  emptySiteAssetMetadata,
  type SiteAssetMetadata,
} from "@/lib/site-assets";
import { STATUS_VIEWS } from "@/lib/status-views";
import type { StatusResponse, TrophiesSummaryPayload } from "@/lib/types";
import { siteContext, type SiteServices } from "@/server/site-context";

import type { Route } from "./+types/page";

const SLOT = {
  activity: "defer-offscreen-always md:col-span-2 [contain-intrinsic-size:auto_350px] md:[contain-intrinsic-size:auto_253px]",
  server: "defer-offscreen-always md:col-span-2 [contain-intrinsic-size:auto_281px]",
  agentStatus: "defer-offscreen-always [contain-intrinsic-size:auto_172px]",
  vibeCoding: "defer-offscreen [contain-intrinsic-size:auto_1372px]",
  playstation: "defer-offscreen-always md:col-span-2 [contain-intrinsic-size:auto_643px]",
  godChat: "md:col-span-2",
  pulse: "defer-offscreen-always md:col-span-2 [contain-intrinsic-size:auto_575px] sm:[contain-intrinsic-size:auto_276px]",
  siteStatus: "mt-3 defer-offscreen-always [contain-intrinsic-size:auto_1440px]",
} as const;

const READS = {
  contact: [GITHUB_CHART_PATH, CODING_YEAR_PATH],
  nowWatching: [NOW_WATCHING_PATH],
  questNow: [STATUS_VIEWS.questNow.path],
  media: [CHARGER_PATH, POWERBANK_PATH, LISTENING_PATH, NOW_LISTENING_PATH],
  activity: [ACTIVITY_PATH, STATUS_VIEWS.workouts.path],
  server: [SERVER_PATH],
  agentStatus: [AGENT_STATUS_PATH],
  vibeCoding: [CODING_PATH, CODING_NOW_PATH, LIMITS_PATH],
  playstation: [NOW_PLAYING_PATH, PLAYING_PATH, TROPHIES_PATH],
  pulse: [PULSE_PATH],
  siteStatus: [GITHUB_REPO_PATH, SITE_DEPLOYMENTS_PATH, CLOUDFLARE_WORKERS_PATH, SENTRY_PATH, SERVER_PATH, REPORTERS_PATH],
  emby: [WATCHING_PATH, NOW_WATCHING_PATH],
} as const;

async function loadSiteAssets(site: SiteServices): Promise<SiteAssetMetadata> {
  try {
    const response = await site.asset(SITE_ASSET_METADATA_PATH);
    if (response.ok) return (await response.json()) as SiteAssetMetadata;
  } catch {
  }
  return emptySiteAssetMetadata();
}

export async function loader({ context }: Route.LoaderArgs) {
  const site = context.get(siteContext);
  const status = site.status;
  const [
    desktop,
    timezone,
    workouts,
    activity,
    server,
    charger,
    powerBank,
    listening,
    nowListening,
    coding,
    codingNow,
    limits,
    agentStatus,
    codingYear,
    watching,
    nowWatching,
    playing,
    playingNow,
    questNow,
    trophiesEnvelope,
    githubChart,
    githubRepo,
    cloudflareWorkers,
    siteDeployments,
    sentry,
    reporters,
    pulse,
    assets,
  ] = await Promise.all([
    status("desktop"),
    status("timezone"),
    status("workouts"),
    status("activity"),
    status("server"),
    status("charger"),
    status("powerBank"),
    status("listening"),
    status("nowListening"),
    status("coding"),
    status("codingNow"),
    status("limits"),
    status("agentStatus"),
    status("codingYear"),
    status("watching"),
    status("nowWatching"),
    status("playing"),
    status("playingNow"),
    status("questNow"),
    status("trophies"),
    status("githubChart"),
    status("githubRepo"),
    status("cloudflareWorkers"),
    status("siteDeployments"),
    status("sentry"),
    status("reporters"),
    status("pulse"),
    loadSiteAssets(site),
  ]);

  const nowSongId =
    nowListening.ok && !nowListening.data.idle && nowListening.data.hasLyrics
      ? nowListening.data.songId
      : null;

  const listeningArtworks = listening.ok
    ? listening.data.items.map((item) => item.artwork)
    : [];
  const nowMusic = nowListening.ok && !nowListening.data.idle ? nowListening.data.music : null;
  const liveHeroArtwork = liveTrack(nowMusic)?.artworkUrl ?? null;
  const heroArtwork = liveHeroArtwork ?? listeningArtworks[0];
  const rowArtworks = liveHeroArtwork ? listeningArtworks : listeningArtworks.slice(1);

  const [desktopIcon, artwork, lyrics] = await Promise.all([
    desktopIconDataUri(site, desktop.ok ? (desktop.data.desktop?.iconUrl ?? null) : null),
    artworkPlaceholders(site, rowArtworks, heroArtwork),
    nowSongId ? site.lyrics(nowSongId) : Promise.resolve(null),
  ]);

  return {
    desktop,
    timezone,
    workouts,
    activity,
    server,
    charger,
    powerBank,
    listening,
    nowListening,
    coding,
    codingNow,
    limits,
    agentStatus,
    codingYear,
    watching,
    nowWatching,
    playing,
    playingNow,
    questNow,
    trophiesEnvelope,
    githubChart,
    githubRepo,
    cloudflareWorkers,
    siteDeployments,
    sentry,
    reporters,
    pulse,
    avatarDataUri: assets.avatarDataUri,
    recentCommits: assets.recentCommits,
    nowSongId,
    desktopIcon,
    artwork,
    lyrics,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const {
    desktop,
    timezone,
    workouts,
    activity,
    server,
    charger,
    powerBank,
    listening,
    nowListening,
    coding,
    codingNow,
    limits,
    agentStatus,
    codingYear,
    watching,
    nowWatching,
    playing,
    playingNow,
    questNow,
    trophiesEnvelope,
    githubChart,
    githubRepo,
    cloudflareWorkers,
    siteDeployments,
    sentry,
    reporters,
    pulse,
    avatarDataUri,
    recentCommits,
    nowSongId,
    desktopIcon,
    artwork,
    lyrics,
  } = loaderData;
  const trophies = trophiesEnvelope as StatusResponse<TrophiesSummaryPayload>;

  return (
    <>
      <WebPlayerProvider>
        <Header desktop={desktop} desktopIconDataUri={desktopIcon} />

        <main className="flex-1">
          <div className="mx-auto my-3.5 w-[calc(100%-2rem)] max-w-5xl sm:my-4">
            <Section id="live" className="p-0 sm:p-0">
              <CardBoundary label="Update" silent paths={[APP_VERSION_PATH]}>
                <AppVersionCard />
              </CardBoundary>
              <CardBoundary label="Stale Reload" silent>
                <StaleTabReload />
              </CardBoundary>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <CardBoundary label="Contact" paths={READS.contact}>
                  <ContactCard
                    avatarDataUri={avatarDataUri}
                    chartFallback={githubChart}
                    yearFallback={codingYear}
                  />
                </CardBoundary>
                <CardBoundary label="Timezone">
                  <TimezoneCard fallback={timezone} />
                </CardBoundary>
              </div>

              {/* 网格 gap 要等卸载才消失，会在收起动画末尾跳动，因此此卡放在网格外。 */}
              <CardBoundary label="Now Watching" silent paths={READS.nowWatching}>
                <NowWatchingCard nowFallback={nowWatching} />
              </CardBoundary>
              <CardBoundary label="Now Playing" silent paths={READS.questNow}>
                <QuestNowCard nowFallback={questNow} />
              </CardBoundary>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <CardBoundary label="Media" className="md:col-span-2" paths={READS.media}>
                  <LiveMediaPair
                    chargerFallback={charger}
                    powerBankFallback={powerBank}
                    listeningFallback={listening}
                    nowListeningFallback={nowListening}
                    lyricsFallback={
                      nowSongId && lyrics && lyrics.lines.length
                        ? { songId: nowSongId, lines: lyrics.lines, songwriters: lyrics.songwriters }
                        : null
                    }
                    artworkPlaceholders={artwork}
                  />
                </CardBoundary>
                <CardBoundary label="Talk to God" className={SLOT.godChat}>
                  <GodChat className={SLOT.godChat} />
                </CardBoundary>
                <CardBoundary label="Activity" className={SLOT.activity} paths={READS.activity}>
                  <ActivityCard fallback={activity} className={SLOT.activity}>
                    <WorkoutsStrip fallback={workouts} />
                  </ActivityCard>
                </CardBoundary>
                <CardBoundary label="Exit Node" className={SLOT.server} paths={READS.server}>
                  <ServerCard fallback={server} className={SLOT.server} />
                </CardBoundary>
                <CardBoundary label="Provider Status" className={SLOT.agentStatus} paths={READS.agentStatus}>
                  <AgentStatusCard fallback={agentStatus} className={SLOT.agentStatus} />
                </CardBoundary>
                <CardBoundary label="Vibe Coding" className={SLOT.vibeCoding} paths={READS.vibeCoding}>
                  <VibeCodingCard
                    fallback={coding}
                    nowFallback={codingNow}
                    limitsFallback={limits}
                    className={SLOT.vibeCoding}
                  />
                </CardBoundary>
                <CardBoundary label="PlayStation" className={SLOT.playstation} paths={READS.playstation}>
                  <PlaystationBlock
                    trophies={trophies}
                    playing={playing}
                    playingNow={playingNow}
                    className={SLOT.playstation}
                  />
                </CardBoundary>
                <CardBoundary label="Pulse" className={SLOT.pulse} paths={READS.pulse}>
                  <PulseCard fallback={pulse} className={SLOT.pulse} />
                </CardBoundary>
              </div>

              <CardBoundary label="LYJWPAGE" className={SLOT.siteStatus} paths={READS.siteStatus}>
                <SiteStatusCard
                  githubFallback={githubRepo}
                  siteFallback={siteDeployments}
                  cloudflareFallback={cloudflareWorkers}
                  sentryFallback={sentry}
                  serverFallback={server}
                  reportersFallback={reporters}
                  recentCommits={recentCommits}
                  className={SLOT.siteStatus}
                />
              </CardBoundary>

              <div
                id="watching"
                className="mt-6 scroll-mt-28 border-t border-line pt-5 defer-offscreen-always [contain-intrinsic-size:auto_270px]"
              >
                <div className="mb-3 flex items-baseline justify-between">
                  <h3 className="text-sm font-medium">Recently Watched</h3>
                  <span className="label-mono text-muted-foreground">Emby</span>
                </div>
                <CardBoundary label="Emby" paths={READS.emby}>
                  <WatchingRow fallback={watching} nowFallback={nowWatching} />
                </CardBoundary>
              </div>
            </Section>
          </div>
        </main>
      </WebPlayerProvider>

      <Footer />

      <DevToggleDock />
      <DevFakeDataToggle />
    </>
  );
}

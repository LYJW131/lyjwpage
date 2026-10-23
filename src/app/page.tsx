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
import { DigestCard } from "@/components/live/digest-card";
import { SiteStatusCard } from "@/components/live/site-status-card";
import { LiveMediaPair } from "@/components/live/media-pair";
import { ServerCard } from "@/components/live/server-card";
import { PlaystationBlock } from "@/components/live/playstation-block";
import { PulseCard } from "@/components/live/pulse-card";
import { NowWatchingCard } from "@/components/live/now-watching-card";
import { QuestNowCard } from "@/components/live/quest-now-card";
import { FocusNowCard } from "@/components/live/focus-now-card";
import { CloudflareOutageRow } from "@/components/live/cloudflare-outage-row";
import { AgentStatusCard } from "@/components/live/agent-status-card";
import { VibeCodingCard } from "@/components/live/vibecoding-card";
import { WatchingRow } from "@/components/live/watching-card";
import { Section } from "@/components/ui/section";
import { artworkPlaceholders } from "@/lib/artwork-placeholder";
import { inlineChargerIcon } from "@/lib/charger-icon-inline";
import { desktopIconDataUri } from "@/lib/desktop-icon-inline";
import { githubAvatarDataUri } from "@/lib/github-avatar-inline";
import { APP_VERSION_PATH } from "@/lib/app-version";
import { liveTrack } from "@shared/home-layout";
import {
  ACTIVITY_PATH,
  AGENT_STATUS_PATH,
  CHARGER_PATH,
  CLOUDFLARE_WORKERS_PATH,
  CODING_NOW_PATH,
  CODING_PATH,
  CODING_YEAR_PATH,
  DIGEST_PATH,
  GITHUB_CHART_PATH,
  GITHUB_REPO_PATH,
  HEALTH_PATH,
  LIMITS_PATH,
  LIMITS_HISTORY_PATH,
  LISTENING_PATH,
  NOW_LISTENING_PATH,
  NOW_PLAYING_PATH,
  NOW_WATCHING_PATH,
  PLAYING_PATH,
  POWERBANK_PATH,
  PULSE_PATH,
  REPORTERS_PATH,
  SERVER_PATH,
  TROPHIES_PATH,
  SITE_DEPLOYMENTS_PATH,
  TIMEZONE_PATH,
  WATCHING_PATH,
} from "@/lib/paths";
import { data } from "react-router";

import { FIRST_SCREEN_UNAVAILABLE, type FirstScreen } from "@/lib/first-screen";
import { NO_STORE } from "@/lib/site-policy";
import { site } from "@shared/site";
import { STATUS_VIEWS, type StatusViewKey } from "@shared/status-views";
import type { StatusResponse, TrophiesSummaryPayload } from "@shared/types";
import { siteContext } from "@/server/site-context";

import type { Route } from "./+types/page";

const SLOT = {
  activity: "defer-offscreen-always md:col-span-2 [contain-intrinsic-size:auto_350px] md:[contain-intrinsic-size:auto_253px]",
  server: "defer-offscreen-always md:col-span-2 [contain-intrinsic-size:auto_281px]",
  agentStatus: "defer-offscreen-always [contain-intrinsic-size:auto_172px]",
  vibeCoding: "defer-offscreen [contain-intrinsic-size:auto_1704px] md:[contain-intrinsic-size:auto_1032px]",
  playstation: "defer-offscreen-always md:col-span-2 [contain-intrinsic-size:auto_655px] md:[contain-intrinsic-size:auto_595px] lg:[contain-intrinsic-size:auto_525px]",
  godChat: "md:col-span-2",
  pulse: "defer-offscreen-always md:col-span-2 [contain-intrinsic-size:auto_559px] sm:[contain-intrinsic-size:auto_355px] lg:[contain-intrinsic-size:auto_363px]",
  siteStatus: "mt-3 defer-offscreen-always [contain-intrinsic-size:auto_1711px] sm:[contain-intrinsic-size:auto_1530px] md:[contain-intrinsic-size:auto_1089px] lg:[contain-intrinsic-size:auto_938px]",
} as const;

const READS = {
  contact: [GITHUB_CHART_PATH, CODING_YEAR_PATH],
  digest: [DIGEST_PATH, PULSE_PATH, TIMEZONE_PATH],
  nowWatching: [NOW_WATCHING_PATH],
  questNow: [STATUS_VIEWS.questNow.path],
  focusNow: [STATUS_VIEWS.focusNow.path],
  media: [CHARGER_PATH, POWERBANK_PATH, LISTENING_PATH, NOW_LISTENING_PATH],
  activity: [ACTIVITY_PATH, STATUS_VIEWS.workouts.path],
  server: [SERVER_PATH],
  agentStatus: [AGENT_STATUS_PATH],
  vibeCoding: [CODING_PATH, CODING_NOW_PATH, LIMITS_PATH, LIMITS_HISTORY_PATH],
  playstation: [NOW_PLAYING_PATH, PLAYING_PATH, TROPHIES_PATH],
  pulse: [PULSE_PATH],
  siteStatus: [GITHUB_REPO_PATH, SITE_DEPLOYMENTS_PATH, CLOUDFLARE_WORKERS_PATH, HEALTH_PATH, SERVER_PATH, REPORTERS_PATH],
  emby: [WATCHING_PATH, NOW_WATCHING_PATH],
} as const;

export async function loader({ context }: Route.LoaderArgs) {
  const site = context.get(siteContext);
  let degraded = false;
  const status = <K extends StatusViewKey>(key: K): Promise<FirstScreen<K>> =>
    site.status(key).catch((error: unknown) => {
      degraded = true;
      console.error("[first-screen]", key, error instanceof Error ? error.message : String(error));
      return { ok: false, error: FIRST_SCREEN_UNAVAILABLE };
    });
  const avatar = githubAvatarDataUri(site);
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
    limitsHistory,
    agentStatus,
    codingYear,
    watching,
    nowWatching,
    playing,
    playingNow,
    questNow,
    focusNow,
    trophiesEnvelope,
    githubChart,
    githubRepo,
    cloudflareWorkers,
    siteDeployments,
    health,
    reporters,
    pulse,
    digest,
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
    status("limitsHistory"),
    status("agentStatus"),
    status("codingYear"),
    status("watching"),
    status("nowWatching"),
    status("playing"),
    status("playingNow"),
    status("questNow"),
    status("focusNow"),
    status("trophies"),
    status("githubChart"),
    status("githubRepo"),
    status("cloudflareWorkers"),
    status("siteDeployments"),
    status("health"),
    status("reporters"),
    status("pulse"),
    status("digest"),
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

  const [avatarDataUri, desktopIcon, chargerWithIcon, artwork, lyrics] = await Promise.all([
    avatar,
    desktopIconDataUri(site, desktop.ok ? (desktop.data.desktop?.iconUrl ?? null) : null),
    inlineChargerIcon(site, charger),
    artworkPlaceholders(site, rowArtworks, heroArtwork),
    nowSongId ? site.lyrics(nowSongId) : Promise.resolve(null),
  ]);

  const payload = {
    desktop,
    timezone,
    workouts,
    activity,
    server,
    charger: chargerWithIcon,
    powerBank,
    listening,
    nowListening,
    coding,
    codingNow,
    limits,
    limitsHistory,
    agentStatus,
    codingYear,
    watching,
    nowWatching,
    playing,
    playingNow,
    questNow,
    focusNow,
    trophiesEnvelope,
    githubChart,
    githubRepo,
    cloudflareWorkers,
    siteDeployments,
    health,
    reporters,
    pulse,
    digest,
    avatarDataUri,
    desktopIcon,
    artwork,
    lyricsFallback:
      nowSongId && lyrics
        ? { songId: nowSongId, lines: lyrics.lines, songwriters: lyrics.songwriters }
        : null,
  };
  // 降级的首页不能进缓存，否则 Unavailable 会撑满整个 SWR 期限。
  return degraded ? data(payload, { headers: { "Cache-Control": NO_STORE } }) : payload;
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const trophies = loaderData.trophiesEnvelope as StatusResponse<TrophiesSummaryPayload>;

  return (
    <>
      <WebPlayerProvider>
        <Header desktop={loaderData.desktop} desktopIconDataUri={loaderData.desktopIcon} />

        <main className="flex-1">
          <h1 className="sr-only">{site.name}</h1>
          <div className="mx-auto my-3.5 w-[calc(100%-2rem)] max-w-5xl sm:my-4">
            <Section id="live" className="p-0 sm:p-0">
              <CardBoundary label="Cloudflare Outage" silent paths={READS.agentStatus}>
                <CloudflareOutageRow fallback={loaderData.agentStatus} />
              </CardBoundary>
              <CardBoundary label="Update" silent paths={[APP_VERSION_PATH]}>
                <AppVersionCard />
              </CardBoundary>
              <CardBoundary label="Stale Reload" silent>
                <StaleTabReload />
              </CardBoundary>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <CardBoundary label="Contact" paths={READS.contact}>
                  <ContactCard
                    avatarDataUri={loaderData.avatarDataUri}
                    chartFallback={loaderData.githubChart}
                    yearFallback={loaderData.codingYear}
                  />
                </CardBoundary>
                <CardBoundary label="In Brief" paths={READS.digest}>
                  <DigestCard fallback={loaderData.digest} pulseFallback={loaderData.pulse} timezoneFallback={loaderData.timezone} />
                </CardBoundary>
              </div>

              {/* 网格 gap 要等卸载才消失，会在收起动画末尾跳动，因此此卡放在网格外。 */}
              <CardBoundary label="Now Watching" silent paths={READS.nowWatching}>
                <NowWatchingCard nowFallback={loaderData.nowWatching} />
              </CardBoundary>
              <CardBoundary label="Focus" silent paths={READS.focusNow}>
                <FocusNowCard nowFallback={loaderData.focusNow} />
              </CardBoundary>
              <CardBoundary label="Now Playing" silent paths={READS.questNow}>
                <QuestNowCard nowFallback={loaderData.questNow} />
              </CardBoundary>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <CardBoundary label="Media" className="md:col-span-2" paths={READS.media}>
                  <LiveMediaPair
                    chargerFallback={loaderData.charger}
                    powerBankFallback={loaderData.powerBank}
                    listeningFallback={loaderData.listening}
                    nowListeningFallback={loaderData.nowListening}
                    lyricsFallback={loaderData.lyricsFallback}
                    artworkPlaceholders={loaderData.artwork}
                  />
                </CardBoundary>
                <CardBoundary label="Talk to God" className={SLOT.godChat}>
                  <GodChat className={SLOT.godChat} />
                </CardBoundary>
                <CardBoundary label="Activity" className={SLOT.activity} paths={READS.activity}>
                  <ActivityCard fallback={loaderData.activity} className={SLOT.activity}>
                    <WorkoutsStrip fallback={loaderData.workouts} />
                  </ActivityCard>
                </CardBoundary>
                <CardBoundary label="Exit Node" className={SLOT.server} paths={READS.server}>
                  <ServerCard fallback={loaderData.server} className={SLOT.server} />
                </CardBoundary>
                <CardBoundary label="Provider Status" className={SLOT.agentStatus} paths={READS.agentStatus}>
                  <AgentStatusCard fallback={loaderData.agentStatus} className={SLOT.agentStatus} />
                </CardBoundary>
                <CardBoundary label="Vibe Coding" className={SLOT.vibeCoding} paths={READS.vibeCoding}>
                  <VibeCodingCard
                    fallback={loaderData.coding}
                    nowFallback={loaderData.codingNow}
                    limitsFallback={loaderData.limits}
                    historyFallback={loaderData.limitsHistory}
                    className={SLOT.vibeCoding}
                  />
                </CardBoundary>
                <CardBoundary label="PlayStation" className={SLOT.playstation} paths={READS.playstation}>
                  <PlaystationBlock
                    trophies={trophies}
                    playing={loaderData.playing}
                    playingNow={loaderData.playingNow}
                    className={SLOT.playstation}
                  />
                </CardBoundary>
                <CardBoundary label="Pulse" className={SLOT.pulse} paths={READS.pulse}>
                  <PulseCard fallback={loaderData.pulse} className={SLOT.pulse} />
                </CardBoundary>
              </div>

              <CardBoundary label="LYJWPAGE" className={SLOT.siteStatus} paths={READS.siteStatus}>
                <SiteStatusCard
                  githubFallback={loaderData.githubRepo}
                  siteFallback={loaderData.siteDeployments}
                  cloudflareFallback={loaderData.cloudflareWorkers}
                  healthFallback={loaderData.health}
                  serverFallback={loaderData.server}
                  reportersFallback={loaderData.reporters}
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
                  <WatchingRow fallback={loaderData.watching} nowFallback={loaderData.nowWatching} />
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
